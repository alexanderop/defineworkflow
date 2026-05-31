# Codex "no model" Bug Fix (Harness Event Types — Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use references/subagent-driven-development/SKILL.md (recommended) or references/executing-plans/SKILL.md to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the model codex actually used by supplying a display-only fallback at the codex adapter (`req.model` → `~/.codex/config.toml` → blank), and de-lie the hand-authored codex fixture so unit tests match the real CLI.

**Architecture:** codex never emits its model in `exec --json` (confirmed: `thread.started` carries only `thread_id`; the human-readable `model:` header is suppressed in JSON mode; `@openai/codex-sdk`'s `ThreadStartedEvent` has no `model`). The stream translator's `ev.model` read is kept for forward-compat but currently never fires. We add a layered, display-only fallback in the **adapter** (not the runtime, not the translator): emit `ctx.onProgress({ model })` from `req.model ?? configModel() ?? undefined`. `configModel` is a best-effort read of `model` from `~/.codex/config.toml` parsed by a tiny TOML-subset reader (no new dependency), injected via `CodexAdapterDeps` so tests stay hermetic. The fallback is emitted first so a future codex that *does* stream a model overrides it (stream takes precedence). The canonical `AgentProgress`/reducer/UI path is untouched.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, ESM), neverthrow `Result`, vitest, `node:fs`/`node:os`. No new runtime or dev dependency.

**Scope note — Phase 1 deferred:** The approved design's Phase 1 (vendor-SDK-as-truth codegen layer: `@openai/codex-sdk` + `@anthropic-ai/claude-agent-sdk` devDeps, vendored copilot `session-events.schema.json`, `ts-to-zod`/`json-schema-to-zod` codegen of a consumed-events allow-list, rewriting all three translators to validate against generated zod, the `capture` command, conformance corpus, and the §5.6 `@workflow/schema` boundary decision) is a large multi-file infrastructure effort that produces human-reviewed generated code and depends on real-CLI captures that CI deliberately excludes. It is **out of scope for this run** and tracked as a follow-up (see "Phase 1 follow-up" at the bottom). Phase 0 is independent and lands first per the design's own phasing.

---

## File Structure

- **Create** `packages/adapters/src/codex-config.ts` — `parseCodexModel(toml, profile?)` (pure TOML-subset reader for the `model` key, top-level or under `[profiles.<name>]`) + `readCodexModel(profile?)` (best-effort `~/.codex/config.toml` read, swallows all errors → `undefined`).
- **Create** `packages/adapters/src/codex-config.test.ts` — unit tests for the pure parser and the best-effort reader.
- **Modify** `packages/adapters/src/codex.ts` — add `configModel?` to `CodexAdapterDeps` (default `readCodexModel`); emit the display-only model fallback via `ctx.onProgress` before spawning.
- **Modify** `packages/adapters/src/codex.test.ts` — inject `configModel` for determinism; add regression tests (model from `req.model`, from config, blank when neither).
- **Modify** `packages/adapters/fixtures/codex-stream.ndjson` — remove the fabricated `"model":"gpt-5-codex"` from line 1.
- **Modify** `packages/adapters/src/codex-stream.test.ts` — assert the stream yields **no** model; add a forward-compat test that a future codex `model` field is read.

---

### Task 1: Codex config model reader (`codex-config.ts`)

**Files:**
- Create: `packages/adapters/src/codex-config.ts`
- Test: `packages/adapters/src/codex-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseCodexModel } from "./codex-config.js";

describe("parseCodexModel", () => {
  it("reads the top-level model key", () => {
    expect(parseCodexModel('model = "gpt-5.5"\napproval_policy = "never"')).toBe("gpt-5.5");
  });

  it("supports single quotes and surrounding whitespace", () => {
    expect(parseCodexModel("  model='o3-mini' ")).toBe("o3-mini");
  });

  it("reads a profile's model when a profile is named", () => {
    const toml = 'model = "gpt-5.5"\n\n[profiles.fast]\nmodel = "o4-mini"\n';
    expect(parseCodexModel(toml, "fast")).toBe("o4-mini");
  });

  it("falls back to top-level model when the named profile has none", () => {
    const toml = 'model = "gpt-5.5"\n[profiles.fast]\napproval_policy = "never"\n';
    expect(parseCodexModel(toml, "fast")).toBe("gpt-5.5");
  });

  it("ignores a model key that belongs to a different table", () => {
    const toml = "[profiles.other]\nmodel = \"nope\"\n";
    expect(parseCodexModel(toml)).toBeUndefined();
    expect(parseCodexModel(toml, "fast")).toBeUndefined();
  });

  it("returns undefined for empty or model-less config", () => {
    expect(parseCodexModel("")).toBeUndefined();
    expect(parseCodexModel("approval_policy = \"never\"")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/adapters/src/codex-config.test.ts`
Expected: FAIL — cannot find module `./codex-config.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Match a `model = "..."` / `model = '...'` assignment, capturing the value. */
const MODEL_LINE = /^\s*model\s*=\s*["']([^"']+)["']/;
/** Match a TOML table header like `[profiles.fast]`, capturing the dotted path. */
const TABLE_HEADER = /^\s*\[([^\]]+)\]\s*$/;

/**
 * Best-effort read of codex's configured `model` from a `config.toml` body.
 * Reads the top-level `model`, and — when `profile` is given — prefers the
 * `[profiles.<profile>]` table's `model`, falling back to the top-level value.
 * This is a deliberately tiny TOML subset (the only key we need) so we add no
 * TOML dependency; anything it can't parse simply yields `undefined`.
 */
export function parseCodexModel(toml: string, profile?: string): string | undefined {
  let topLevel: string | undefined;
  let profileModel: string | undefined;
  let currentTable = ""; // "" = the root table
  const wantTable = profile !== undefined ? `profiles.${profile}` : undefined;

  for (const line of toml.split("\n")) {
    const header = TABLE_HEADER.exec(line);
    if (header?.[1] !== undefined) {
      currentTable = header[1].trim();
      continue;
    }
    const m = MODEL_LINE.exec(line);
    if (m?.[1] === undefined) continue;
    if (currentTable === "") topLevel = m[1];
    else if (wantTable !== undefined && currentTable === wantTable) profileModel = m[1];
  }

  return profileModel ?? topLevel;
}

/**
 * Best-effort read of `~/.codex/config.toml`'s `model`. Never throws — a missing
 * or unreadable file yields `undefined` (we then leave the model display blank
 * rather than guessing codex's built-in default).
 */
export function readCodexModel(profile?: string): string | undefined {
  try {
    const body = readFileSync(join(homedir(), ".codex", "config.toml"), "utf8");
    return parseCodexModel(body, profile);
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/adapters/src/codex-config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/codex-config.ts packages/adapters/src/codex-config.test.ts
git commit -m "feat(adapters): best-effort codex config.toml model reader"
```

---

### Task 2: De-lie the codex fixture + retarget the stream test

**Files:**
- Modify: `packages/adapters/fixtures/codex-stream.ndjson:1`
- Modify: `packages/adapters/src/codex-stream.test.ts`

- [ ] **Step 1: Update the stream test to match reality (fails first)**

In `packages/adapters/src/codex-stream.test.ts`, replace the model assertion in the
first test with a "no model" assertion, and add a forward-compat test:

```ts
  it("extracts tool calls, final text and real usage from the fixture (no model — codex never emits it)", () => {
    const t = createCodexTranslator();
    const progress = drive(t, fixture);

    expect(progress.find((p) => p.model)).toBeUndefined();
    expect(progress.filter((p) => p.tool).map((p) => p.tool!.name)).toEqual(["Shell", "Mcp"]);
    expect(progress.filter((p) => p.tokens !== undefined).map((p) => p.tokens)).toEqual([256]);

    const final = t.result();
    expect(final.text).toBe('{"n": 7}');
    expect(final.usage).toEqual({ inputTokens: 2048, outputTokens: 256 });
  });

  it("reads a model from thread.started if a future codex ever emits one (forward-compat)", () => {
    const t = createCodexTranslator();
    expect(t.push('{"type":"thread.started","model":"gpt-6","thread_id":"t1"}')).toEqual([{ model: "gpt-6" }]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/adapters/src/codex-stream.test.ts`
Expected: FAIL — the fixture still contains `"model":"gpt-5-codex"`, so `progress.find((p) => p.model)` is defined.

- [ ] **Step 3: Remove the fabricated model from the fixture**

Edit `packages/adapters/fixtures/codex-stream.ndjson` line 1 to drop the model field:

```
{"type":"thread.started","thread_id":"t1"}
```

(Lines 2–6 are unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/adapters/src/codex-stream.test.ts`
Expected: PASS (the original two follow-on tests plus the retargeted + forward-compat tests).

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/fixtures/codex-stream.ndjson packages/adapters/src/codex-stream.test.ts
git commit -m "test(adapters): de-lie codex fixture — stream emits no model"
```

---

### Task 3: Adapter-level display-only model fallback

**Files:**
- Modify: `packages/adapters/src/codex.ts`
- Modify: `packages/adapters/src/codex.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/adapters/src/codex.test.ts`, (a) make the existing first test hermetic by
injecting `configModel: () => undefined` into its `createCodexAdapter({ ... })` call, and
(b) append regression tests:

```ts
  it("emits req.model as the display model when the stream carries none", async () => {
    const fake = createFakeProcessRunner({ codex: { stdout: stream, code: 0 } });
    const adapter = createCodexAdapter({ processRunner: fake, fileStore: stubFileStore(), configModel: () => undefined });
    const progress: AgentProgress[] = [];
    await adapter.run(
      { prompt: "x", model: "gpt-5.5", cwd: "/tmp", signal: new AbortController().signal },
      { runId: "r" as RunId, seq: 0, onProgress: (p) => progress.push(p) },
    );
    expect(progress.find((p) => p.model)?.model).toBe("gpt-5.5");
  });

  it("falls back to the codex config model when req.model is absent", async () => {
    const fake = createFakeProcessRunner({ codex: { stdout: stream, code: 0 } });
    const adapter = createCodexAdapter({ processRunner: fake, fileStore: stubFileStore(), configModel: () => "gpt-5-from-config" });
    const progress: AgentProgress[] = [];
    await adapter.run(
      { prompt: "x", cwd: "/tmp", signal: new AbortController().signal },
      { runId: "r" as RunId, seq: 0, onProgress: (p) => progress.push(p) },
    );
    expect(progress.find((p) => p.model)?.model).toBe("gpt-5-from-config");
  });

  it("emits no model when neither req.model nor config resolves one", async () => {
    const fake = createFakeProcessRunner({ codex: { stdout: stream, code: 0 } });
    const adapter = createCodexAdapter({ processRunner: fake, fileStore: stubFileStore(), configModel: () => undefined });
    const progress: AgentProgress[] = [];
    await adapter.run(
      { prompt: "x", cwd: "/tmp", signal: new AbortController().signal },
      { runId: "r" as RunId, seq: 0, onProgress: (p) => progress.push(p) },
    );
    expect(progress.find((p) => p.model)).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/adapters/src/codex.test.ts`
Expected: FAIL — `configModel` is not a known dep and no model progress is emitted.

- [ ] **Step 3: Wire the fallback into the adapter**

In `packages/adapters/src/codex.ts`:

Add the import:

```ts
import { createCodexTranslator } from "./codex-stream.js";
import { readCodexModel } from "./codex-config.js";
```

Extend `CodexAdapterDeps`:

```ts
export interface CodexAdapterDeps {
  readonly processRunner: ProcessRunner;
  readonly fileStore?: FileStore;
  readonly bin?: string;
  /** Best-effort display-only model lookup; defaults to reading `~/.codex/config.toml`. */
  readonly configModel?: (profile?: string) => string | undefined;
}
```

Resolve the dep near the top of `createCodexAdapter`:

```ts
  const fileStore = deps.fileStore ?? createDefaultFileStore();
  const configModel = deps.configModel ?? readCodexModel;
```

Inside `run`, right after `const translator = createCodexTranslator();` and before the
`processRunner.run({...})` call, emit the display-only fallback (stream model, if a future
codex ever sends one, arrives later and overrides it in the reducer):

```ts
        const translator = createCodexTranslator();
        // codex `exec --json` never emits its model, so surface a display-only model
        // for the UI: the request's model, else the configured default. Never changes
        // which model codex actually runs; a future codex that streams a model overrides.
        const displayModel = req.model ?? configModel();
        if (displayModel !== undefined) ctx.onProgress?.({ model: displayModel });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/adapters/src/codex.test.ts`
Expected: PASS (existing tests + 3 new regression tests).

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/codex.ts packages/adapters/src/codex.test.ts
git commit -m "fix(adapters): codex emits a display-only model fallback (req.model -> config.toml)"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck, lint, and full unit suite**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: all green. (`pnpm build` first so dependent packages have fresh `dist/` declarations.)

- [ ] **Step 2: Commit any incidental fixes**

```bash
git add -A
git commit -m "chore(adapters): verification fixes for codex model fallback" || true
```

---

## Phase 1 follow-up (tracked, out of scope for this run)

Recorded so the next run / PR reviewer picks it up:

1. Add `@openai/codex-sdk` + `@anthropic-ai/claude-agent-sdk` as **devDependencies**; vendor copilot's `schemas/session-events.schema.json` (no dep) + a refresh script.
2. Codegen pipeline (`pnpm codegen:harness-events`): a committed consumed-events allow-list per harness → `ts-to-zod` / `json-schema-to-zod` → committed `*-events.generated.ts` (only import: `z`).
3. Rewrite the three translators to validate/narrow each line against the generated zod union at the raw→canonical seam.
4. `capture` command (manual/dev, spends tokens) → real fixtures; a conformance test driving every fixture line through the generated zod.
5. Resolve the §5.6 boundary: lean (a) — put generated event-zod + a `validateEvent` helper in `@workflow/schema` so the single-zod-boundary invariant holds.

Open questions to settle in the Phase 1 plan: `capture` as a `workflow` subcommand vs `pnpm` script; exact consumed-events allow-list per harness; copilot schema refresh (scripted `npm pack` extraction vs manual).
