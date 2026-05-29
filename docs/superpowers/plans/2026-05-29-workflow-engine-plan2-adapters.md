# Workflow Engine — Plan 2: `@workflow/adapters` (real harness execution)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@workflow/adapters` — `AgentRunner` implementations that drive real coding harnesses (claude, codex, copilot) and a raw-API fallback, each turning a prompt + JSON Schema into a validated `AgentResult`, with a validate→retry loop, harness auto-detection, and a config-driven generic adapter. Fully unit-tested via an injected fake process runner + recorded fixtures (zero API cost), plus an opt-in real-CLI e2e suite.

**Architecture:** A thin, injectable `ProcessRunner` seam isolates subprocess spawning so every adapter is testable without invoking a real CLI. Each adapter = argv builder + result parser (written against a **real captured fixture**) + the shared validate/retry coercion. v1 uses each CLI's single-result mode (`claude --output-format json` + `--json-schema`, `codex exec --output-schema`, `copilot -p`); streaming tool-event drill-down is deferred to a Plan 3 enhancement. Errors are values (`Result<AgentResult, WorkflowError>`); nothing throws across module boundaries.

**Tech Stack:** TypeScript strict, `@workflow/core` (`AgentRunner` contract, `WorkflowError`), `@workflow/schema` (`validate`), neverthrow, Zod, `node:child_process` + `node:readline` (no new runtime deps for CLI adapters), `@anthropic-ai/sdk` (raw-api adapter only), Vitest.

> Depends on Plan 1 (merged to `main`). Branch from `main`.

---

## Verified CLI facts (from the installed tools)

| Harness | Version | Non-interactive | Native schema | Result mode used in v1 | Usage source |
|---|---|---|---|---|---|
| claude | 2.1.156 | `-p`/`--print` | `--json-schema <json>` | `--output-format json` (single result object) | `usage.input_tokens`/`output_tokens` in the result |
| codex | 0.125.0 | `codex exec` | `--output-schema <file>` | `-o <file>` (final message) + `--output-schema` | best-effort (estimate v1) |
| copilot | 1.0.55 | `-p`/`--prompt` | none | `-p --silent` (text) | best-effort (estimate v1) |
| raw-api | — | SDK | SDK tool/JSON mode | direct SDK call | exact from SDK |

claude single-result JSON shape (stable): `{ "type": "result", "subtype": "success", "result": <string|object>, "usage": { "input_tokens": N, "output_tokens": N, ... }, "total_cost_usd": N, "is_error": false, ... }`. With `--json-schema`, `result` holds the structured object.

> **Fixture-first rule for parsers:** each CLI-adapter task captures ONE real, tiny invocation into `packages/adapters/fixtures/<id>-result.json(l)` and writes the parser against that actual shape. If the CLI is unauthenticated/unavailable in the implementation environment, the task falls back to the representative fixture provided inline and is flagged DONE_WITH_CONCERNS so the e2e suite reconciles later.

---

## File Structure (Plan 2)

```
packages/adapters/
├─ package.json
├─ tsconfig.json
├─ fixtures/                         # recorded golden CLI outputs (committed)
│  ├─ claude-result.json
│  ├─ codex-result.txt
│  └─ copilot-result.txt
└─ src/
   ├─ index.ts                       # public exports + createAdapter() + autoDetect()
   ├─ process-runner.ts              # ProcessRunner interface + child_process impl
   ├─ fake-process-runner.ts         # test double (replays canned stdout/exit)
   ├─ coercion.ts                    # runWithSchemaRetry(): validate→retry loop
   ├─ detect.ts                      # PATH probe + capability matrix
   ├─ claude.ts                      # createClaudeAdapter
   ├─ codex.ts                       # createCodexAdapter
   ├─ copilot.ts                     # createCopilotAdapter
   ├─ raw-api.ts                     # createRawApiAdapter (injected completion fn)
   ├─ generic.ts                     # createGenericAdapter (config template)
   ├─ json.ts                        # extractJson + compileJsonSchemaValidator (Ajv)
   └─ *.test.ts / *.e2e.test.ts
```

**Dependency rule:** `adapters` depends only on `@workflow/core` types + `@workflow/schema`. No dependency from `core` back to `adapters`.

---

## Phase 0 — scaffold

### Task 1: `@workflow/adapters` package skeleton

**Files:** Create `packages/adapters/package.json`, `packages/adapters/tsconfig.json`, `packages/adapters/src/index.ts`

- [ ] **Step 1: Create `packages/adapters/package.json`**

```json
{
  "name": "@workflow/adapters",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@workflow/core": "workspace:*",
    "@workflow/schema": "workspace:*",
    "ajv": "^8.17.0",
    "neverthrow": "^8.1.0",
    "zod": "^4.0.0"
  },
  "optionalDependencies": {
    "@anthropic-ai/sdk": "^0.40.0"
  }
}
```

- [ ] **Step 2: Create `packages/adapters/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create placeholder `packages/adapters/src/index.ts`**

```ts
export {};
```

- [ ] **Step 4: Install + verify**

Run: `pnpm install`
Expected: resolves the workspace deps. `@anthropic-ai/sdk` is optional — if it fails to install, that's acceptable (raw-api uses it lazily).

- [ ] **Step 5: Commit**

```bash
git add packages/adapters
git commit -m "chore: scaffold @workflow/adapters package"
```

---

## Phase 1 — the process seam

### Task 2: `ProcessRunner` interface + child_process impl + fake

**Files:** Create `packages/adapters/src/process-runner.ts`, `packages/adapters/src/fake-process-runner.ts`, `packages/adapters/src/process-runner.test.ts`, `packages/adapters/src/fake-process-runner.test.ts`

- [ ] **Step 1: Write failing test `packages/adapters/src/fake-process-runner.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createFakeProcessRunner } from "./fake-process-runner.js";

describe("FakeProcessRunner", () => {
  it("returns canned stdout/exit matched by command, and records the call", async () => {
    const fake = createFakeProcessRunner({
      claude: { stdout: '{"ok":true}', code: 0 },
    });
    const ctrl = new AbortController();
    const out = await fake.run({ command: "claude", args: ["-p", "hi"], cwd: "/tmp", signal: ctrl.signal });
    expect(out.code).toBe(0);
    expect(out.stdout).toBe('{"ok":true}');
    expect(fake.calls()[0]?.args).toEqual(["-p", "hi"]);
  });

  it("supports a per-command handler that can read stdin", async () => {
    const fake = createFakeProcessRunner({
      cat: (spec) => ({ stdout: spec.stdin ?? "", code: 0 }),
    });
    const out = await fake.run({ command: "cat", args: [], cwd: "/tmp", signal: new AbortController().signal, stdin: "piped" });
    expect(out.stdout).toBe("piped");
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `pnpm vitest run packages/adapters/src/fake-process-runner.test.ts` → cannot find module.

- [ ] **Step 3: Create `packages/adapters/src/process-runner.ts`**

```ts
import { spawn } from "node:child_process";

export interface ProcessSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly stdin?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface ProcessOutput {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessRunner {
  run(spec: ProcessSpec): Promise<ProcessOutput>;
}

/** Default runner: spawns a real child process, buffers stdout/stderr, resolves on close. */
export function createProcessRunner(): ProcessRunner {
  return {
    run: (spec) =>
      new Promise<ProcessOutput>((resolve, reject) => {
        const child = spawn(spec.command, [...spec.args], {
          cwd: spec.cwd,
          signal: spec.signal,
          env: spec.env ? { ...process.env, ...spec.env } : process.env,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => {
          stdout += d.toString("utf8");
        });
        child.stderr.on("data", (d: Buffer) => {
          stderr += d.toString("utf8");
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
        if (spec.stdin !== undefined) {
          child.stdin.end(spec.stdin);
        }
      }),
  };
}
```

- [ ] **Step 4: Create `packages/adapters/src/fake-process-runner.ts`**

```ts
import type { ProcessRunner, ProcessSpec, ProcessOutput } from "./process-runner.js";

export type FakeResponse =
  | { readonly stdout?: string; readonly stderr?: string; readonly code?: number }
  | ((spec: ProcessSpec) => { stdout?: string; stderr?: string; code?: number });

export interface FakeProcessRunner extends ProcessRunner {
  calls(): readonly ProcessSpec[];
}

/** Test double: matches a response by `spec.command`. */
export function createFakeProcessRunner(
  responses: Readonly<Record<string, FakeResponse>>,
): FakeProcessRunner {
  const recorded: ProcessSpec[] = [];
  return {
    run: async (spec): Promise<ProcessOutput> => {
      recorded.push(spec);
      const r = responses[spec.command];
      const resolved = typeof r === "function" ? r(spec) : (r ?? {});
      return { code: resolved.code ?? 0, stdout: resolved.stdout ?? "", stderr: resolved.stderr ?? "" };
    },
    calls: () => recorded,
  };
}
```

- [ ] **Step 5: Run fake test, confirm PASS.**

- [ ] **Step 6: Write `packages/adapters/src/process-runner.test.ts`** (real spawn, cross-platform-safe via `node -e`)

```ts
import { describe, it, expect } from "vitest";
import { createProcessRunner } from "./process-runner.js";

describe("createProcessRunner", () => {
  it("captures stdout and exit code from a real process", async () => {
    const runner = createProcessRunner();
    const out = await runner.run({
      command: process.execPath, // node
      args: ["-e", "process.stdout.write('hello'); process.exit(0)"],
      cwd: process.cwd(),
      signal: new AbortController().signal,
    });
    expect(out.code).toBe(0);
    expect(out.stdout).toBe("hello");
  });

  it("forwards stdin", async () => {
    const runner = createProcessRunner();
    const out = await runner.run({
      command: process.execPath,
      args: ["-e", "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d.toUpperCase()))"],
      cwd: process.cwd(),
      signal: new AbortController().signal,
      stdin: "abc",
    });
    expect(out.stdout).toBe("ABC");
  });
});
```

- [ ] **Step 7: Run, confirm PASS.**

- [ ] **Step 8: Commit**

```bash
git add packages/adapters/src/process-runner.ts packages/adapters/src/fake-process-runner.ts packages/adapters/src/process-runner.test.ts packages/adapters/src/fake-process-runner.test.ts
git commit -m "feat(adapters): injectable ProcessRunner + child_process impl + fake"
```

---

## Phase 2 — validate/retry coercion

### Task 3: `runWithSchemaRetry` — the shared coercion loop

**Files:** Create `packages/adapters/src/coercion.ts`, `packages/adapters/src/coercion.test.ts`

This is the heart of "always validate, retry on mismatch". An adapter supplies (1) an `attempt` function that performs one attempt (build argv, run process, parse → `{ text, data, usage }`), and (2) an optional `validate(data) => issues|null` function. The loop validates `data`, and on failure retries up to N times, feeding the issues back into the next attempt's prompt. The validator is a plain function — NOT a Zod schema — because CLI adapters only hold a JSON Schema (`req.schema`), not a Zod type. Native-schema adapters (claude/codex) pass no validator; prompt-injection adapters (copilot/generic) pass an Ajv-compiled validator.

- [ ] **Step 1: Write failing test `packages/adapters/src/coercion.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { runWithSchemaRetry } from "./coercion.js";

// Helper: turn a Zod schema into the (data) => issues|null validator the loop expects.
const zodValidator = (schema: z.ZodType) => (data: unknown): readonly string[] | null => {
  const r = schema.safeParse(data);
  return r.success ? null : r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
};

describe("runWithSchemaRetry", () => {
  it("returns the result immediately when there is no validator", async () => {
    const r = await runWithSchemaRetry({
      validate: undefined,
      maxRetries: 2,
      attempt: async () => ({ text: "plain", data: undefined, usage: { inputTokens: 1, outputTokens: 2 } }),
    });
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().text).toBe("plain");
  });

  it("returns data when the validator passes", async () => {
    const r = await runWithSchemaRetry({
      validate: zodValidator(z.object({ n: z.number() })),
      maxRetries: 2,
      attempt: async () => ({ text: "{}", data: { n: 5 }, usage: { inputTokens: 0, outputTokens: 0 } }),
    });
    expect(r._unsafeUnwrap().data).toEqual({ n: 5 });
  });

  it("retries with feedback when validation fails, then succeeds", async () => {
    const feedback: (string | undefined)[] = [];
    let call = 0;
    const r = await runWithSchemaRetry({
      validate: zodValidator(z.object({ n: z.number() })),
      maxRetries: 3,
      attempt: async (retryHint) => {
        feedback.push(retryHint);
        call++;
        return call < 2
          ? { text: "bad", data: { n: "oops" }, usage: { inputTokens: 0, outputTokens: 0 } }
          : { text: "good", data: { n: 7 }, usage: { inputTokens: 0, outputTokens: 0 } };
      },
    });
    expect(r._unsafeUnwrap().data).toEqual({ n: 7 });
    expect(call).toBe(2);
    expect(feedback[0]).toBeUndefined();       // first attempt has no hint
    expect(feedback[1]).toMatch(/n/);          // retry hint mentions the failing field
  });

  it("returns SchemaValidation error after exhausting retries", async () => {
    const r = await runWithSchemaRetry({
      validate: zodValidator(z.object({ n: z.number() })),
      maxRetries: 2,
      attempt: async () => ({ text: "bad", data: { n: "x" }, usage: { inputTokens: 0, outputTokens: 0 } }),
    });
    expect(r.isErr()).toBe(true);
    const e = r._unsafeUnwrapErr();
    expect(e.kind).toBe("SchemaValidation");
    expect(e.kind === "SchemaValidation" && e.attempts).toBe(2);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Create `packages/adapters/src/coercion.ts`**

```ts
import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import type { WorkflowError } from "@workflow/core";

export interface Attempt {
  readonly text: string;
  readonly data: unknown;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

/** Validates parsed data; returns an array of issue strings on failure, or null when valid. */
export type Validator = (data: unknown) => readonly string[] | null;

export interface CoercionSpec {
  /** Omit for adapters whose harness enforces the schema natively (claude/codex). */
  readonly validate: Validator | undefined;
  readonly maxRetries: number;
  /** Performs one attempt. `retryHint` is feedback from the prior failed attempt, or undefined on the first. */
  attempt(retryHint: string | undefined): Promise<Attempt>;
}

export interface CoercedResult {
  readonly text: string;
  readonly data: unknown;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

export async function runWithSchemaRetry(
  spec: CoercionSpec,
): Promise<Result<CoercedResult, WorkflowError>> {
  const { validate } = spec;
  let hint: string | undefined;
  let lastIssues: readonly string[] = [];
  const attempts = Math.max(1, spec.maxRetries);

  for (let i = 0; i < attempts; i++) {
    const a = await spec.attempt(hint);
    if (!validate) {
      return ok({ text: a.text, data: a.data, usage: a.usage });
    }
    const issues = validate(a.data);
    if (issues === null) {
      return ok({ text: a.text, data: a.data, usage: a.usage });
    }
    lastIssues = issues;
    hint = `Your previous response did not match the required schema. Issues: ${issues.join("; ")}. Return ONLY valid JSON matching the schema.`;
  }

  return err({ kind: "SchemaValidation", issues: lastIssues, attempts });
}
```

- [ ] **Step 4: Run, confirm PASS (all 4 cases).**

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/coercion.ts packages/adapters/src/coercion.test.ts
git commit -m "feat(adapters): validate->retry coercion loop with feedback"
```

---

## Phase 3 — detection

### Task 4: harness detection + capability matrix

**Files:** Create `packages/adapters/src/detect.ts`, `packages/adapters/src/detect.test.ts`

- [ ] **Step 1: Write failing test `packages/adapters/src/detect.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { CAPABILITIES, detectAdapters } from "./detect.js";

describe("detect", () => {
  it("exposes a capability matrix for the known harnesses", () => {
    expect(CAPABILITIES.claude.nativeSchema).toBe(true);
    expect(CAPABILITIES.codex.nativeSchema).toBe(true);
    expect(CAPABILITIES.copilot.nativeSchema).toBe(false);
    expect(CAPABILITIES["raw-api"].reportsTokens).toBe(true);
  });

  it("detects only the harnesses present on PATH (injected probe)", async () => {
    const present = await detectAdapters({ exists: async (bin) => bin === "codex" });
    expect(present).toContain("codex");
    expect(present).not.toContain("claude");
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Create `packages/adapters/src/detect.ts`**

```ts
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

export type AdapterId = "claude" | "codex" | "copilot" | "raw-api";

export interface Capabilities {
  readonly nativeSchema: boolean;
  readonly reportsTokens: boolean;
  readonly toolEvents: boolean;
}

export const CAPABILITIES: Readonly<Record<AdapterId, Capabilities>> = {
  claude: { nativeSchema: true, reportsTokens: true, toolEvents: false },
  codex: { nativeSchema: true, reportsTokens: false, toolEvents: false },
  copilot: { nativeSchema: false, reportsTokens: false, toolEvents: false },
  "raw-api": { nativeSchema: true, reportsTokens: true, toolEvents: false },
};

const CLI_BINS: Readonly<Record<string, string>> = { claude: "claude", codex: "codex", copilot: "copilot" };

/** Probe a binary on PATH. Default uses fs.access across PATH dirs; injectable for tests. */
async function binExists(bin: string): Promise<boolean> {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    try {
      await access(join(dir, bin), constants.X_OK);
      return true;
    } catch {
      // not here; keep looking
    }
  }
  return false;
}

export interface DetectDeps {
  readonly exists?: (bin: string) => Promise<boolean>;
}

/** Returns the CLI adapter ids whose binary is on PATH. `raw-api` is always available (no binary). */
export async function detectAdapters(deps: DetectDeps = {}): Promise<readonly AdapterId[]> {
  const exists = deps.exists ?? binExists;
  const found: AdapterId[] = [];
  for (const [id, bin] of Object.entries(CLI_BINS)) {
    if (await exists(bin)) found.push(id as AdapterId);
  }
  return found;
}
```

- [ ] **Step 4: Run, confirm PASS.**

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/detect.ts packages/adapters/src/detect.test.ts
git commit -m "feat(adapters): harness detection + capability matrix"
```

---

## Phase 4 — the CLI adapters (fixture-first)

Each adapter implements `AgentRunner` from `@workflow/core`:
```ts
interface AgentRunner {
  readonly id: string;
  readonly capabilities: { nativeSchema: boolean; reportsTokens: boolean; toolEvents: boolean };
  run(req: AgentRequest, ctx: RunCtx): Promise<Result<AgentResult, WorkflowError>>;
}
```
`AgentRequest = { prompt, schema?: JsonSchema, model?, agentType?, label?, cwd, signal }`. `AgentResult = { text, data?, usage: {inputTokens, outputTokens, approximate?}, toolCalls: ToolEvent[] }`. v1 adapters return `toolCalls: []` (tool-event drill-down is a Plan 3 enhancement).

Each adapter is constructed with an injected `ProcessRunner` so it's testable without the real CLI:
```ts
createClaudeAdapter({ processRunner, maxRetries? }): AgentRunner
```

### Task 5: claude adapter

**Files:** Create `packages/adapters/fixtures/claude-result.json`, `packages/adapters/src/claude.ts`, `packages/adapters/src/claude.test.ts`

- [ ] **Step 1: Capture a real fixture (or use the representative one).**

Try to capture the real single-result shape (cheap, one tiny prompt):
```bash
claude -p "Reply with the JSON object {\"n\": 7} and nothing else." \
  --output-format json --json-schema '{"type":"object","properties":{"n":{"type":"number"}},"required":["n"],"additionalProperties":false}' \
  > packages/adapters/fixtures/claude-result.json 2>/dev/null || true
```
Inspect the file. If it is a valid claude result object, KEEP it as the fixture. If the CLI is unauthenticated/unavailable (empty or error), WRITE this representative fixture verbatim instead and note DONE_WITH_CONCERNS:
```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "result": { "n": 7 },
  "usage": { "input_tokens": 12, "output_tokens": 8 },
  "total_cost_usd": 0.0001,
  "session_id": "abc"
}
```
Record which path you took. Whatever the real shape is, the parser in Step 3 MUST parse the fixture you committed — adjust the parser (not the fixture) to reality.

- [ ] **Step 2: Write failing test `packages/adapters/src/claude.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { createClaudeAdapter } from "./claude.js";
import { createFakeProcessRunner } from "./fake-process-runner.js";

const fixture = readFileSync(new URL("../fixtures/claude-result.json", import.meta.url), "utf8");

describe("claude adapter", () => {
  it("builds the expected argv and parses structured result + usage from the fixture", async () => {
    const fake = createFakeProcessRunner({ claude: { stdout: fixture, code: 0 } });
    const adapter = createClaudeAdapter({ processRunner: fake });
    expect(adapter.id).toBe("claude");
    expect(adapter.capabilities.nativeSchema).toBe(true);

    const res = await adapter.run(
      { prompt: "give n", schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false }, cwd: "/tmp", label: "a", signal: new AbortController().signal },
      { runId: "r", seq: 0 },
    );
    expect(res.isOk()).toBe(true);
    const r = res._unsafeUnwrap();
    expect(r.data).toEqual({ n: 7 });
    expect(r.usage.outputTokens).toBeGreaterThanOrEqual(0);

    const argv = fake.calls()[0]!.args;
    expect(argv).toContain("-p");
    expect(argv).toContain("--output-format");
    expect(argv).toContain("json");
    expect(argv).toContain("--json-schema");
  });

  it("returns an AdapterSpawn error on non-zero exit", async () => {
    const fake = createFakeProcessRunner({ claude: { stdout: "", stderr: "boom", code: 1 } });
    const adapter = createClaudeAdapter({ processRunner: fake });
    const res = await adapter.run(
      { prompt: "x", cwd: "/tmp", signal: new AbortController().signal },
      { runId: "r", seq: 0 },
    );
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().kind).toBe("AdapterSpawn");
  });
});
```

- [ ] **Step 3: Create `packages/adapters/src/claude.ts`**

```ts
import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import type { AgentRunner, AgentRequest, AgentResult, RunCtx, WorkflowError } from "@workflow/core";
import type { ProcessRunner } from "./process-runner.js";
import { CAPABILITIES } from "./detect.js";

export interface ClaudeAdapterDeps {
  readonly processRunner: ProcessRunner;
  readonly maxRetries?: number;
  readonly bin?: string;
}

interface ClaudeResult {
  readonly result?: unknown;
  readonly is_error?: boolean;
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
}

export function createClaudeAdapter(deps: ClaudeAdapterDeps): AgentRunner {
  const bin = deps.bin ?? "claude";
  return {
    id: "claude",
    capabilities: CAPABILITIES.claude,
    run: async (req: AgentRequest, _ctx: RunCtx): Promise<Result<AgentResult, WorkflowError>> => {
      const args = ["-p", req.prompt, "--output-format", "json", "--permission-mode", "acceptEdits", "--add-dir", req.cwd];
      if (req.schema) args.push("--json-schema", JSON.stringify(req.schema));
      if (req.model) args.push("--model", req.model);

      const out = await deps.processRunner.run({ command: bin, args, cwd: req.cwd, signal: req.signal });
      if (out.code !== 0) {
        const e: WorkflowError = { kind: "AdapterSpawn", adapter: "claude", cause: out.stderr || `exit ${out.code}` };
        return err(e);
      }

      let parsed: ClaudeResult;
      try {
        parsed = JSON.parse(out.stdout) as ClaudeResult;
      } catch (e) {
        return err({ kind: "AdapterSpawn", adapter: "claude", cause: `unparseable result: ${e instanceof Error ? e.message : String(e)}` });
      }
      if (parsed.is_error) {
        return err({ kind: "AdapterSpawn", adapter: "claude", cause: "claude reported is_error" });
      }

      const data = req.schema ? parsed.result : undefined;
      const text = typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result ?? "");
      const result: AgentResult = {
        text,
        ...(data !== undefined ? { data } : {}),
        usage: { inputTokens: parsed.usage?.input_tokens ?? 0, outputTokens: parsed.usage?.output_tokens ?? 0 },
        toolCalls: [],
      };
      return ok(result);
    },
  };
}
```

> Note: claude's `--json-schema` enforces the shape server-side, so v1's claude adapter does not need the retry loop (it's wired in codex/copilot where coercion is prompt-side). If the captured fixture shows `result` under a different key (e.g. a nested `structured`/`content`), adjust the `ClaudeResult` interface and the `data`/`text` extraction to match the real shape — keep the test assertions about `{n:7}`.

- [ ] **Step 4: Run, confirm PASS. Then `pnpm --filter @workflow/adapters typecheck`, `pnpm lint`.**

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/fixtures/claude-result.json packages/adapters/src/claude.ts packages/adapters/src/claude.test.ts
git commit -m "feat(adapters): claude adapter (native --json-schema, single-result parse)"
```

### Task 6: codex adapter

**Files:** Create `packages/adapters/fixtures/codex-result.txt`, `packages/adapters/src/codex.ts`, `packages/adapters/src/codex.test.ts`

codex uses `--output-schema <file>` (a JSON Schema file) and `-o <file>` (final message file). Since both are files, the adapter needs a temp-file mechanism. To stay testable AND avoid real fs in unit tests, inject a `fileStore`:

- [ ] **Step 1: Capture/representative fixture `packages/adapters/fixtures/codex-result.txt`**

Try the real capture (writes the final message to a file):
```bash
cd /tmp && codex exec --skip-git-repo-check \
  --output-schema <(echo '{"type":"object","properties":{"n":{"type":"number"}},"required":["n"],"additionalProperties":false}') \
  -o /tmp/codex-out.txt "Reply with {\"n\": 7}" >/dev/null 2>&1 && cp /tmp/codex-out.txt "$OLDPWD/packages/adapters/fixtures/codex-result.txt" || true
```
If unavailable, write the representative fixture (the final message is the JSON the schema constrained):
```
{"n": 7}
```
Record which path you took. The codex `-o` file contains ONLY the final assistant message (JSON when `--output-schema` is given).

- [ ] **Step 2: Write failing test `packages/adapters/src/codex.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createCodexAdapter } from "./codex.js";
import { createFakeProcessRunner } from "./fake-process-runner.js";

const fixture = readFileSync(new URL("../fixtures/codex-result.txt", import.meta.url), "utf8");

describe("codex adapter", () => {
  it("writes a schema file, passes -o, parses the final-message file, and builds expected argv", async () => {
    const files = new Map<string, string>();
    const fake = createFakeProcessRunner({
      // simulate codex writing its -o output file
      codex: (spec) => {
        const oIndex = spec.args.indexOf("-o");
        const outPath = spec.args[oIndex + 1]!;
        files.set(outPath, fixture);
        return { stdout: "", code: 0 };
      },
    });
    const adapter = createCodexAdapter({
      processRunner: fake,
      fileStore: {
        writeTemp: async (_name, content) => { const p = `/tmp/${_name}`; files.set(p, content); return p; },
        read: async (p) => files.get(p) ?? "",
        cleanup: async () => {},
      },
    });
    expect(adapter.id).toBe("codex");

    const res = await adapter.run(
      { prompt: "give n", schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false }, cwd: "/tmp", label: "a", signal: new AbortController().signal },
      { runId: "r", seq: 0 },
    );
    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap().data).toEqual({ n: 7 });

    const argv = fake.calls()[0]!.args;
    expect(argv[0]).toBe("exec");
    expect(argv).toContain("--output-schema");
    expect(argv).toContain("-o");
    expect(argv).toContain("--skip-git-repo-check");
  });

  it("returns AdapterSpawn on non-zero exit", async () => {
    const adapter = createCodexAdapter({
      processRunner: createFakeProcessRunner({ codex: { stdout: "", stderr: "bad", code: 2 } }),
      fileStore: { writeTemp: async () => "/tmp/s", read: async () => "", cleanup: async () => {} },
    });
    const res = await adapter.run({ prompt: "x", cwd: "/tmp", signal: new AbortController().signal }, { runId: "r", seq: 0 });
    expect(res._unsafeUnwrapErr().kind).toBe("AdapterSpawn");
  });
});
```

- [ ] **Step 3: Create `packages/adapters/src/codex.ts`**

```ts
import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import { writeFile, readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunner, AgentRequest, AgentResult, RunCtx, WorkflowError } from "@workflow/core";
import type { ProcessRunner } from "./process-runner.js";
import { CAPABILITIES } from "./detect.js";

export interface FileStore {
  writeTemp(name: string, content: string): Promise<string>;
  read(path: string): Promise<string>;
  cleanup(paths: readonly string[]): Promise<void>;
}

export function createDefaultFileStore(): FileStore {
  return {
    writeTemp: async (name, content) => {
      const dir = await mkdtemp(join(tmpdir(), "wf-codex-"));
      const path = join(dir, name);
      await writeFile(path, content, "utf8");
      return path;
    },
    read: async (path) => readFile(path, "utf8"),
    cleanup: async (paths) => {
      for (const p of paths) await rm(p, { force: true }).catch(() => {});
    },
  };
}

export interface CodexAdapterDeps {
  readonly processRunner: ProcessRunner;
  readonly fileStore?: FileStore;
  readonly bin?: string;
}

export function createCodexAdapter(deps: CodexAdapterDeps): AgentRunner {
  const bin = deps.bin ?? "codex";
  const fileStore = deps.fileStore ?? createDefaultFileStore();
  return {
    id: "codex",
    capabilities: CAPABILITIES.codex,
    run: async (req: AgentRequest, _ctx: RunCtx): Promise<Result<AgentResult, WorkflowError>> => {
      const created: string[] = [];
      const outPath = await fileStore.writeTemp("codex-out.txt", "");
      created.push(outPath);
      const args = ["exec", "--skip-git-repo-check", "-C", req.cwd, "--full-auto", "-o", outPath];
      if (req.schema) {
        const schemaPath = await fileStore.writeTemp("codex-schema.json", JSON.stringify(req.schema));
        created.push(schemaPath);
        args.push("--output-schema", schemaPath);
      }
      if (req.model) args.push("-m", req.model);
      args.push(req.prompt);

      try {
        const out = await deps.processRunner.run({ command: bin, args, cwd: req.cwd, signal: req.signal });
        if (out.code !== 0) {
          return err({ kind: "AdapterSpawn", adapter: "codex", cause: out.stderr || `exit ${out.code}` });
        }
        const finalMessage = (await fileStore.read(outPath)).trim();
        let data: unknown;
        if (req.schema) {
          try {
            data = JSON.parse(finalMessage);
          } catch {
            return err({ kind: "AdapterSpawn", adapter: "codex", cause: "final message was not valid JSON for the schema" });
          }
        }
        const outputTokens = Math.ceil(finalMessage.length / 4); // best-effort estimate
        const result: AgentResult = {
          text: finalMessage,
          ...(data !== undefined ? { data } : {}),
          usage: { inputTokens: 0, outputTokens, approximate: true },
          toolCalls: [],
        };
        return ok(result);
      } finally {
        await fileStore.cleanup(created);
      }
    },
  };
}
```

> Note: if the real capture shows codex's `-o` file wraps the message (e.g. with surrounding prose), adjust extraction to isolate the JSON. The capability `reportsTokens: false` reflects the estimate; a later enhancement can parse `--json` events for exact usage.

- [ ] **Step 4: Run, confirm PASS. typecheck + lint.**

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/fixtures/codex-result.txt packages/adapters/src/codex.ts packages/adapters/src/codex.test.ts
git commit -m "feat(adapters): codex adapter (--output-schema + -o final message)"
```

### Task 7: copilot adapter (prompt-injected schema + retry)

**Files:** Create `packages/adapters/fixtures/copilot-result.txt`, `packages/adapters/src/copilot.ts`, `packages/adapters/src/copilot.test.ts`

copilot has no native schema, so this adapter is where `runWithSchemaRetry` + prompt injection + JSON extraction earn their keep.

- [ ] **Step 1: Representative fixture `packages/adapters/fixtures/copilot-result.txt`** (copilot `-p --silent` prints the agent's text; with our injected instruction it returns fenced or bare JSON)

```
Here is the result:
```json
{ "n": 7 }
```
```
(Capturing a real copilot fixture is optional; the parser must handle both fenced and bare JSON. If you capture a real one, ensure the extractor still finds the JSON.)

This task also creates the shared `packages/adapters/src/json.ts` (used by copilot and the generic adapter): `extractJson(text)` and `compileJsonSchemaValidator(jsonSchema)` (Ajv-backed, returns the `Validator` type from `coercion.ts`).

- [ ] **Step 2: Write failing tests**

`packages/adapters/src/json.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { extractJson, compileJsonSchemaValidator } from "./json.js";

describe("extractJson", () => {
  it("pulls JSON out of a fenced code block", () => {
    expect(extractJson('text\n```json\n{"n":7}\n```\nmore')).toEqual({ n: 7 });
  });
  it("pulls bare JSON object from surrounding prose", () => {
    expect(extractJson('Sure! {"n": 8} done')).toEqual({ n: 8 });
  });
  it("returns undefined when no JSON present", () => {
    expect(extractJson("no json here")).toBeUndefined();
  });
});

describe("compileJsonSchemaValidator", () => {
  const schema = { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false };
  it("returns null for valid data", () => {
    expect(compileJsonSchemaValidator(schema)({ n: 7 })).toBeNull();
  });
  it("returns issue strings for invalid data", () => {
    const issues = compileJsonSchemaValidator(schema)({ n: "x" });
    expect(issues).not.toBeNull();
    expect((issues ?? []).length).toBeGreaterThan(0);
  });
});
```

`packages/adapters/src/copilot.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createCopilotAdapter } from "./copilot.js";
import { createFakeProcessRunner } from "./fake-process-runner.js";

describe("copilot adapter", () => {
  it("injects the schema into the prompt, extracts+validates JSON, builds expected argv", async () => {
    const fake = createFakeProcessRunner({ copilot: { stdout: '```json\n{"n":7}\n```', code: 0 } });
    const adapter = createCopilotAdapter({ processRunner: fake });
    expect(adapter.capabilities.nativeSchema).toBe(false);

    const res = await adapter.run(
      { prompt: "give n", schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false }, cwd: "/tmp", label: "a", signal: new AbortController().signal },
      { runId: "r", seq: 0 },
    );
    expect(res._unsafeUnwrap().data).toEqual({ n: 7 });

    const argv = fake.calls()[0]!.args;
    expect(argv).toContain("-p");
    expect(argv).toContain("--allow-all-tools");
    expect(argv).toContain("--no-ask-user");
    expect(argv).toContain("--silent");
    // the prompt arg should contain the injected schema instruction
    const promptArg = argv[argv.indexOf("-p") + 1]!;
    expect(promptArg).toMatch(/schema/i);
  });

  it("retries with feedback then errors as SchemaValidation after maxRetries", async () => {
    let n = 0;
    const fake = createFakeProcessRunner({ copilot: () => { n++; return { stdout: '{"n":"bad"}', code: 0 }; } });
    const adapter = createCopilotAdapter({ processRunner: fake, maxRetries: 2 });
    const res = await adapter.run(
      { prompt: "give n", schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false }, cwd: "/tmp", signal: new AbortController().signal },
      { runId: "r", seq: 0 },
    );
    expect(res._unsafeUnwrapErr().kind).toBe("SchemaValidation");
    expect(n).toBe(2);
  });
});
```

- [ ] **Step 3: Create `packages/adapters/src/json.ts`** (shared by copilot + generic)

```ts
import Ajv from "ajv";
import type { Validator } from "./coercion.js";

/** Extract a JSON value from CLI text: prefer a ```json fenced block, else the first balanced {...} or [...]. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) return undefined;
  for (let end = candidate.length; end > start; end--) {
    const slice = candidate.slice(start, end);
    try {
      return JSON.parse(slice) as unknown;
    } catch {
      // shrink the window and retry
    }
  }
  return undefined;
}

/** Compile a JSON Schema into the `Validator` shape the coercion loop expects. */
export function compileJsonSchemaValidator(schema: Record<string, unknown>): Validator {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateFn = ajv.compile(schema);
  return (data: unknown): readonly string[] | null => {
    if (data === undefined) return ["no JSON value found in output"];
    const valid = validateFn(data);
    if (valid) return null;
    return (validateFn.errors ?? []).map((e) => `${e.instancePath || "(root)"} ${e.message ?? "invalid"}`);
  };
}
```

> Note: `import Ajv from "ajv"` is the documented default import for Ajv 8 under ESM/`verbatimModuleSyntax`. If tsc/runtime complains about the default-vs-namespace interop, use `import { Ajv } from "ajv"` (Ajv 8.12+ also exports it named) — report which form worked.

- [ ] **Step 4: Create `packages/adapters/src/copilot.ts`**

```ts
import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import type { AgentRunner, AgentRequest, AgentResult, RunCtx, WorkflowError } from "@workflow/core";
import type { ProcessRunner } from "./process-runner.js";
import { runWithSchemaRetry } from "./coercion.js";
import { extractJson, compileJsonSchemaValidator } from "./json.js";
import { CAPABILITIES } from "./detect.js";

export interface CopilotAdapterDeps {
  readonly processRunner: ProcessRunner;
  readonly maxRetries?: number;
  readonly bin?: string;
}

export function createCopilotAdapter(deps: CopilotAdapterDeps): AgentRunner {
  const bin = deps.bin ?? "copilot";
  const maxRetries = deps.maxRetries ?? 2;
  return {
    id: "copilot",
    capabilities: CAPABILITIES.copilot,
    run: async (req: AgentRequest, _ctx: RunCtx): Promise<Result<AgentResult, WorkflowError>> => {
      let spawnError: WorkflowError | undefined;
      const validate = req.schema ? compileJsonSchemaValidator(req.schema) : undefined;

      const result = await runWithSchemaRetry({
        validate,
        maxRetries,
        attempt: async (hint) => {
          const schemaInstr = req.schema
            ? `\n\nRespond with ONLY a JSON value matching this JSON Schema:\n${JSON.stringify(req.schema)}`
            : "";
          const prompt = `${req.prompt}${schemaInstr}${hint ? `\n\n${hint}` : ""}`;
          const args = ["-p", prompt, "--allow-all-tools", "--no-ask-user", "--silent", "-C", req.cwd];
          if (req.model) args.push("--model", req.model);
          const out = await deps.processRunner.run({ command: bin, args, cwd: req.cwd, signal: req.signal });
          if (out.code !== 0) {
            spawnError = { kind: "AdapterSpawn", adapter: "copilot", cause: out.stderr || `exit ${out.code}` };
            throw new Error("copilot spawn failed");
          }
          const data = req.schema ? extractJson(out.stdout) : undefined;
          return { text: out.stdout, data, usage: { inputTokens: 0, outputTokens: Math.ceil(out.stdout.length / 4) } };
        },
      });

      if (spawnError) return err(spawnError);
      if (result.isErr()) return err(result.error);
      const r = result.value;
      return ok({
        text: r.text,
        ...(r.data !== undefined ? { data: r.data } : {}),
        usage: { ...r.usage, approximate: true },
        toolCalls: [],
      });
    },
  };
}
```

> The `spawnError` capture is how a non-zero exit (a hard failure, not a schema mismatch) short-circuits the retry loop: the `attempt` throws so the loop stops, and the adapter returns the captured `AdapterSpawn` instead of a `SchemaValidation` after pointless retries.

- [ ] **Step 5: Run json + copilot + coercion tests, confirm PASS. typecheck + lint.**

- [ ] **Step 6: Commit**

```bash
git add packages/adapters/src/json.ts packages/adapters/src/json.test.ts packages/adapters/src/copilot.ts packages/adapters/src/copilot.test.ts packages/adapters/fixtures/copilot-result.txt
git commit -m "feat(adapters): copilot adapter (prompt-injected schema + ajv validate/retry)"
```

---

## Phase 5 — raw-api fallback + generic adapter

### Task 8: raw-api adapter (injected completion fn)

**Files:** Create `packages/adapters/src/raw-api.ts`, `packages/adapters/src/raw-api.test.ts`

The raw-api adapter calls a model provider directly. To keep it testable and avoid a hard SDK dependency in tests, it takes an injected `complete` function; the default (lazy-loaded) implementation uses `@anthropic-ai/sdk`.

- [ ] **Step 1: Write failing test `packages/adapters/src/raw-api.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createRawApiAdapter } from "./raw-api.js";

describe("raw-api adapter", () => {
  it("delegates to the injected completion fn and returns validated data + exact usage", async () => {
    const adapter = createRawApiAdapter({
      complete: async (req) => {
        expect(req.prompt).toBe("give n");
        return { text: '{"n":7}', data: { n: 7 }, usage: { inputTokens: 10, outputTokens: 4 } };
      },
    });
    expect(adapter.id).toBe("raw-api");
    expect(adapter.capabilities.reportsTokens).toBe(true);
    const res = await adapter.run(
      { prompt: "give n", schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false }, cwd: "/tmp", signal: new AbortController().signal },
      { runId: "r", seq: 0 },
    );
    expect(res._unsafeUnwrap().data).toEqual({ n: 7 });
    expect(res._unsafeUnwrap().usage.outputTokens).toBe(4);
  });

  it("maps a thrown completion error to AdapterSpawn", async () => {
    const adapter = createRawApiAdapter({ complete: async () => { throw new Error("no api key"); } });
    const res = await adapter.run({ prompt: "x", cwd: "/tmp", signal: new AbortController().signal }, { runId: "r", seq: 0 });
    expect(res._unsafeUnwrapErr().kind).toBe("AdapterSpawn");
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Create `packages/adapters/src/raw-api.ts`**

```ts
import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import type { AgentRunner, AgentRequest, AgentResult, RunCtx, WorkflowError } from "@workflow/core";
import { CAPABILITIES } from "./detect.js";

export interface CompletionRequest {
  readonly prompt: string;
  readonly schema?: Record<string, unknown>;
  readonly model?: string;
  readonly signal: AbortSignal;
}

export interface CompletionResult {
  readonly text: string;
  readonly data?: unknown;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

export interface RawApiAdapterDeps {
  /** Injected to keep the adapter testable and the SDK optional. */
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export function createRawApiAdapter(deps: RawApiAdapterDeps): AgentRunner {
  return {
    id: "raw-api",
    capabilities: CAPABILITIES["raw-api"],
    run: async (req: AgentRequest, _ctx: RunCtx): Promise<Result<AgentResult, WorkflowError>> => {
      try {
        const r = await deps.complete({
          prompt: req.prompt,
          ...(req.schema ? { schema: req.schema } : {}),
          ...(req.model ? { model: req.model } : {}),
          signal: req.signal,
        });
        const result: AgentResult = {
          text: r.text,
          ...(r.data !== undefined ? { data: r.data } : {}),
          usage: { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens },
          toolCalls: [],
        };
        return ok(result);
      } catch (e) {
        const cause = e instanceof Error ? e.message : String(e);
        const wErr: WorkflowError = { kind: "AdapterSpawn", adapter: "raw-api", cause };
        return err(wErr);
      }
    },
  };
}
```

- [ ] **Step 4: Run, confirm PASS. typecheck + lint.**

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/raw-api.ts packages/adapters/src/raw-api.test.ts
git commit -m "feat(adapters): raw-api adapter with injected completion fn"
```

### Task 9: generic template adapter

**Files:** Create `packages/adapters/src/generic.ts`, `packages/adapters/src/generic.test.ts`

Config-driven adapter so users wire Gemini CLI / aider / cursor without TypeScript. Config:
```ts
interface GenericAdapterConfig {
  id: string;
  command: string;
  promptArg: "stdin" | "last" | { flag: string };  // how the prompt is passed
  args?: readonly string[];                          // static extra args
  modelFlag?: string;                                // e.g. "--model"
  schema?: "prompt-inject" | "none";                 // schema strategy
  maxRetries?: number;
}
```

- [ ] **Step 1: Write failing test `packages/adapters/src/generic.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { createGenericAdapter } from "./generic.js";
import { createFakeProcessRunner } from "./fake-process-runner.js";

describe("generic adapter", () => {
  it("passes the prompt via stdin and parses extracted JSON when schema=prompt-inject", async () => {
    const fake = createFakeProcessRunner({ gemini: (spec) => ({ stdout: `result: {"n":7}`, code: 0, stdin: spec.stdin }) });
    const adapter = createGenericAdapter(
      { id: "gemini", command: "gemini", promptArg: "stdin", args: ["-o", "json"], schema: "prompt-inject" },
      { processRunner: fake },
    );
    expect(adapter.id).toBe("gemini");
    const res = await adapter.run(
      { prompt: "give n", schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false }, cwd: "/tmp", signal: new AbortController().signal },
      { runId: "r", seq: 0 },
    );
    expect(res._unsafeUnwrap().data).toEqual({ n: 7 });
    expect(fake.calls()[0]!.stdin).toMatch(/give n/);
    expect(fake.calls()[0]!.args).toEqual(["-o", "json"]);
  });

  it("passes the prompt as the last positional arg when promptArg=last", async () => {
    const fake = createFakeProcessRunner({ aider: { stdout: "ok", code: 0 } });
    const adapter = createGenericAdapter({ id: "aider", command: "aider", promptArg: "last", schema: "none" }, { processRunner: fake });
    await adapter.run({ prompt: "hello", cwd: "/tmp", signal: new AbortController().signal }, { runId: "r", seq: 0 });
    const argv = fake.calls()[0]!.args;
    expect(argv[argv.length - 1]).toBe("hello");
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Create `packages/adapters/src/generic.ts`** using the shared `json.ts` (`extractJson` + `compileJsonSchemaValidator`) created in Task 7. Build argv per `promptArg`, run, and when `schema === "prompt-inject"` use `runWithSchemaRetry` with the Ajv validator (same helper as copilot).

```ts
import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import type { AgentRunner, AgentRequest, AgentResult, RunCtx, WorkflowError } from "@workflow/core";
import type { ProcessRunner } from "./process-runner.js";
import { extractJson } from "./json.js";
import { runWithSchemaRetry } from "./coercion.js";
import { compileJsonSchemaValidator } from "./json.js";

export interface GenericAdapterConfig {
  readonly id: string;
  readonly command: string;
  readonly promptArg: "stdin" | "last" | { readonly flag: string };
  readonly args?: readonly string[];
  readonly modelFlag?: string;
  readonly schema?: "prompt-inject" | "none";
  readonly maxRetries?: number;
}

export interface GenericAdapterDeps {
  readonly processRunner: ProcessRunner;
}

export function createGenericAdapter(config: GenericAdapterConfig, deps: GenericAdapterDeps): AgentRunner {
  const maxRetries = config.maxRetries ?? 2;
  const useSchema = config.schema === "prompt-inject";
  return {
    id: config.id,
    capabilities: { nativeSchema: false, reportsTokens: false, toolEvents: false },
    run: async (req: AgentRequest, _ctx: RunCtx): Promise<Result<AgentResult, WorkflowError>> => {
      let spawnError: WorkflowError | undefined;
      const validate = useSchema && req.schema ? compileJsonSchemaValidator(req.schema) : undefined;

      const result = await runWithSchemaRetry({
        validate,
        maxRetries,
        attempt: async (hint) => {
          const schemaInstr = useSchema && req.schema
            ? `\n\nRespond with ONLY JSON matching this schema:\n${JSON.stringify(req.schema)}`
            : "";
          const fullPrompt = `${req.prompt}${schemaInstr}${hint ? `\n\n${hint}` : ""}`;
          const args = [...(config.args ?? [])];
          let stdin: string | undefined;
          if (config.promptArg === "stdin") stdin = fullPrompt;
          else if (config.promptArg === "last") args.push(fullPrompt);
          else args.push(config.promptArg.flag, fullPrompt);
          if (config.modelFlag && req.model) args.push(config.modelFlag, req.model);

          const out = await deps.processRunner.run({
            command: config.command, args, cwd: req.cwd, signal: req.signal,
            ...(stdin !== undefined ? { stdin } : {}),
          });
          if (out.code !== 0) {
            spawnError = { kind: "AdapterSpawn", adapter: config.id, cause: out.stderr || `exit ${out.code}` };
            throw new Error("spawn failed");
          }
          const data = useSchema && req.schema ? extractJson(out.stdout) : undefined;
          return { text: out.stdout, data, usage: { inputTokens: 0, outputTokens: Math.ceil(out.stdout.length / 4) } };
        },
      });

      if (spawnError) return err(spawnError);
      if (result.isErr()) return err(result.error);
      const r = result.value;
      return ok({ text: r.text, ...(r.data !== undefined ? { data: r.data } : {}), usage: { ...r.usage, approximate: true }, toolCalls: [] });
    },
  };
}
```

- [ ] **Step 4: Run generic tests, confirm PASS. typecheck + lint.**

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/generic.ts packages/adapters/src/generic.test.ts
git commit -m "feat(adapters): generic config-driven adapter"
```

---

## Phase 6 — public API + factory

### Task 10: `index.ts` — exports, `createAdapter`, `autoDetectAdapter`

**Files:** Modify `packages/adapters/src/index.ts`, create `packages/adapters/src/index.test.ts`

- [ ] **Step 1: Write failing test `packages/adapters/src/index.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import * as adapters from "./index.js";
import { createFakeProcessRunner } from "./fake-process-runner.js";

describe("adapters public API", () => {
  it("exports adapter factories + detection", () => {
    expect(typeof adapters.createClaudeAdapter).toBe("function");
    expect(typeof adapters.createCodexAdapter).toBe("function");
    expect(typeof adapters.createCopilotAdapter).toBe("function");
    expect(typeof adapters.createRawApiAdapter).toBe("function");
    expect(typeof adapters.createGenericAdapter).toBe("function");
    expect(typeof adapters.detectAdapters).toBe("function");
    expect(typeof adapters.createAdapter).toBe("function");
  });

  it("createAdapter builds a known CLI adapter by id", () => {
    const a = adapters.createAdapter("claude", { processRunner: createFakeProcessRunner({}) });
    expect(a.id).toBe("claude");
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Replace `packages/adapters/src/index.ts`**

```ts
export * from "./process-runner.js";
export { createFakeProcessRunner, type FakeProcessRunner, type FakeResponse } from "./fake-process-runner.js";
export { runWithSchemaRetry, type Attempt, type CoercionSpec, type CoercedResult } from "./coercion.js";
export { CAPABILITIES, detectAdapters, type AdapterId, type Capabilities } from "./detect.js";
export { createClaudeAdapter, type ClaudeAdapterDeps } from "./claude.js";
export { createCodexAdapter, createDefaultFileStore, type CodexAdapterDeps, type FileStore } from "./codex.js";
export { createCopilotAdapter, type CopilotAdapterDeps } from "./copilot.js";
export { createRawApiAdapter, type RawApiAdapterDeps, type CompletionRequest, type CompletionResult } from "./raw-api.js";
export { createGenericAdapter, type GenericAdapterConfig, type GenericAdapterDeps } from "./generic.js";
export { extractJson, compileJsonSchemaValidator } from "./json.js";

import type { AgentRunner } from "@workflow/core";
import type { ProcessRunner } from "./process-runner.js";
import { createClaudeAdapter } from "./claude.js";
import { createCodexAdapter } from "./codex.js";
import { createCopilotAdapter } from "./copilot.js";

/** Build a built-in CLI adapter by id (claude/codex/copilot). raw-api and generic are constructed directly. */
export function createAdapter(
  id: "claude" | "codex" | "copilot",
  deps: { processRunner: ProcessRunner; maxRetries?: number },
): AgentRunner {
  switch (id) {
    case "claude":
      return createClaudeAdapter(deps);
    case "codex":
      return createCodexAdapter(deps);
    case "copilot":
      return createCopilotAdapter(deps);
  }
}
```

- [ ] **Step 4: Run the gate:**
- `pnpm vitest run packages/adapters` → all green
- `pnpm -r build` → `@workflow/adapters` builds with `.d.ts`
- `pnpm test` → whole monorepo green
- `pnpm lint` → 0 errors
- `pnpm -r typecheck` → clean

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/index.ts packages/adapters/src/index.test.ts
git commit -m "feat(adapters): public API + createAdapter factory"
```

---

## Phase 7 — opt-in real-CLI e2e

### Task 11: e2e smoke per installed adapter

**Files:** Create `packages/adapters/src/adapters.e2e.test.ts`

- [ ] **Step 1: Create `packages/adapters/src/adapters.e2e.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { toJsonSchema } from "@workflow/schema";
import { createProcessRunner } from "./process-runner.js";
import { detectAdapters } from "./detect.js";
import { createClaudeAdapter } from "./claude.js";
import { createCodexAdapter } from "./codex.js";
import { createCopilotAdapter } from "./copilot.js";

const ENABLED = process.env.WORKFLOW_E2E === "1";
const d = ENABLED ? describe : describe.skip;

d("real-CLI adapter smoke (costs tokens)", () => {
  const schema = toJsonSchema(z.object({ answer: z.number() }))._unsafeUnwrap();
  const prompt = "Return JSON with key 'answer' set to the number 42. Output only the JSON.";

  it("detects installed harnesses", async () => {
    const present = await detectAdapters();
    expect(Array.isArray(present)).toBe(true);
  });

  it("claude returns schema-valid structured output (if installed)", async () => {
    const present = await detectAdapters();
    if (!present.includes("claude")) return;
    const adapter = createClaudeAdapter({ processRunner: createProcessRunner() });
    const res = await adapter.run({ prompt, schema, cwd: process.cwd(), signal: AbortSignal.timeout(120_000) }, { runId: "e2e", seq: 0 });
    expect(res.isOk()).toBe(true);
    expect((res._unsafeUnwrap().data as { answer: number }).answer).toBe(42);
  }, 130_000);

  it("codex returns schema-valid structured output (if installed)", async () => {
    const present = await detectAdapters();
    if (!present.includes("codex")) return;
    const adapter = createCodexAdapter({ processRunner: createProcessRunner() });
    const res = await adapter.run({ prompt, schema, cwd: process.cwd(), signal: AbortSignal.timeout(120_000) }, { runId: "e2e", seq: 0 });
    expect(res.isOk()).toBe(true);
  }, 130_000);

  it("copilot returns schema-valid structured output (if installed)", async () => {
    const present = await detectAdapters();
    if (!present.includes("copilot")) return;
    const adapter = createCopilotAdapter({ processRunner: createProcessRunner() });
    const res = await adapter.run({ prompt, schema, cwd: process.cwd(), signal: AbortSignal.timeout(120_000) }, { runId: "e2e", seq: 0 });
    expect(res.isOk()).toBe(true);
  }, 130_000);
});
```

- [ ] **Step 2: Verify it SKIPS by default**

Run: `pnpm test` → the e2e cases are skipped (no `WORKFLOW_E2E`). Confirm the suite stays green and fast.

- [ ] **Step 3: (Manual, optional) run for real**

Run: `pnpm test:e2e` (sets `WORKFLOW_E2E=1`). This actually invokes the installed CLIs and costs tokens. Record results; if a parser needs adjustment to match real output, fix the adapter + its fixture and re-run the unit tests. This is the reconciliation step for any fixture captured as "representative".

- [ ] **Step 4: Commit**

```bash
git add packages/adapters/src/adapters.e2e.test.ts
git commit -m "test(adapters): opt-in real-CLI e2e smoke (WORKFLOW_E2E=1)"
```

---

## Self-Review (against the design spec §6)

- Pluggable `AgentRunner` adapters via injected `ProcessRunner` → Tasks 2, 5–9.
- claude `--json-schema` / codex `--output-schema` / copilot prompt-inject; **always validate, retry on mismatch** → Tasks 3, 5, 6, 7, 9.
- raw-api fallback with exact usage → Task 8.
- auto-detect via PATH probe + capability matrix → Task 4, 10.
- generic config-driven adapter (Gemini/aider/cursor) → Task 9.
- recorded golden fixtures + `WORKFLOW_RECORD`-style capture → Tasks 5–7 (fixture-first), reconciled by Task 11.
- adapter selection precedence (`createAdapter` by id; `autoDetect`) → Task 10. *(Per-call/`meta.defaultAdapter`/CLI-flag precedence is wired in Plan 4 where the runtime + CLI live.)*

**Deferred (correctly out of Plan 2 scope):** streaming tool-event drill-down (`toolCalls` is `[]`, `toolEvents:false` for now) → Plan 3; worktree isolation, fs-backed run dir + `JournalCorrupt`, and binding adapters into `createRuntime`/the CLI → Plan 4.

**Known deviations flagged for the implementer:**
- `runWithSchemaRetry` validates via an injected `validate(data) => string[] | null` (a plain function, NOT a Zod schema) so JSON-Schema-only adapters (copilot, generic) work via an Ajv-compiled validator (`compileJsonSchemaValidator` in `json.ts`); claude/codex pass no validator (native schema). Ajv is a dependency.
- codex token usage is a length estimate (`reportsTokens:false`); claude/raw-api report exact.
- Fixtures may be "representative" if the CLI is unauthenticated at implementation time; Task 11 reconciles against reality.

---

## Next

- **Plan 3 — `@workflow/ui`:** Ink Miller-columns view over the event stream; keybindings; `ink-testing-library` tests; TTY-less fallback.
- **Plan 4 — `@workflow/cli`:** `workflow` bin (run/watch/list/resume/stop/save/adapters), detached spawning + fs run registry (`journal.jsonl`/`events.jsonl`/`script.snapshot` + `JournalCorrupt`), consent + permission modes, config + adapter selection precedence, worktree isolation, bundled `deep-research`/`vue-newsletter`, real-CLI e2e of full workflows.
```
