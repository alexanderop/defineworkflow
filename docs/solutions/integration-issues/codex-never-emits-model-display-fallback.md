---
title: "codex exec --json never emits its model — supply a display-only fallback at the adapter"
date: 2026-05-31
track: bug
category: integration-issues
problem_type: "cli_adapter_schema_failure"
module: "adapters"
component: "codex"
tags: ["codex", "model", "stream-translator", "onprogress", "fixture", "ndjson", "display-only", "config-toml", "drift"]
symptoms: "codex agents show tokens + elapsed but a blank model in the TUI, while claude/copilot show theirs; the codex stream unit test nonetheless passes."
root_cause: "codex exec --json emits no model on any event (thread.started carries only thread_id; the human-readable model: header is suppressed in --json mode; @openai/codex-sdk's ThreadStartedEvent has no model). The hand-authored fixture had a fabricated model field the real CLI never sends, so the unit test asserted behavior that never existed."
resolution_type: "code-fix"
related:
  - "architecture-patterns/streaming-agent-progress-normalization-boundary.md"
  - "integration-issues/claude-schema-output-retry.md"
---

# codex exec --json never emits its model — supply a display-only fallback at the adapter

## Problem

In a multi-harness run, the `codex` agent displayed tokens and elapsed time but a **blank
model**, while `claude` and `copilot` displayed theirs. The codex stream unit test passed, so
nothing flagged the gap.

## Symptoms

- TUI agent row for a codex agent shows `running · N tok · Ns` but no model string.
- `packages/adapters/src/codex-stream.test.ts` is green — it asserted a model was extracted.
- Model reaches the UI only via streaming `onProgress({ model })`; the final `AgentResult` has
  no model field, so a missing stream model means permanently blank.

## What Didn't Work

- Trusting the translator's `ev.model` read on `thread.started`/`turn.started`. Confirmed three
  ways that codex never sends it: (1) empirical capture of `codex exec --json` (codex-cli 0.125.0)
  shows `thread.started` → `turn.started` (bare) → `item.completed` → `turn.completed`, none
  carrying a model; (2) the human-readable `model:` header is suppressed in `--json` mode (absent
  on stdout and stderr); (3) `@openai/codex-sdk`'s `ThreadStartedEvent` is
  `{ type: "thread.started"; thread_id: string }` — `model` exists only in *input* config
  (`ThreadOptions`/`TurnOptions`).
- The unit test only passed because `fixtures/codex-stream.ndjson` was hand-authored with a
  fabricated `"model":"gpt-5-codex"`. **A hand-written fixture can assert behavior the real CLI
  never had** — the test was lying.

## Solution

Supply the model as **display-only metadata at the adapter**, not from the stream. The translator
keeps its `ev.model` read for forward-compat (a future codex that streams a model overrides),
emitted *first* so the later stream value wins via the reducer's latest-write semantics.

`packages/adapters/src/codex-config.ts` (new) — best-effort read of `~/.codex/config.toml`'s
`model`, no new dependency (a tiny TOML-subset regex reader), profile-aware, swallows all errors:

```ts
const MODEL_LINE = /^\s*model\s*=\s*["']([^"']+)["']/;
const TABLE_HEADER = /^\s*\[([^\]]+)\]\s*$/;

export function parseCodexModel(toml: string, profile?: string): string | undefined {
  let topLevel: string | undefined, profileModel: string | undefined, currentTable = "";
  const wantTable = profile !== undefined ? `profiles.${profile}` : undefined;
  for (const line of toml.split("\n")) {
    const header = TABLE_HEADER.exec(line);
    if (header?.[1] !== undefined) { currentTable = header[1].trim(); continue; }
    const m = MODEL_LINE.exec(line);
    if (m?.[1] === undefined) continue;
    if (currentTable === "") topLevel = m[1];
    else if (wantTable !== undefined && currentTable === wantTable) profileModel = m[1];
  }
  return profileModel ?? topLevel;
}

export function readCodexModel(profile?: string): string | undefined {
  try { return parseCodexModel(readFileSync(join(homedir(), ".codex", "config.toml"), "utf8"), profile); }
  catch { return undefined; }
}
```

`packages/adapters/src/codex.ts` — inject `configModel?` on `CodexAdapterDeps` (defaults to
`readCodexModel`, so tests stay hermetic) and emit the fallback before spawning:

```ts
const translator = createCodexTranslator();
// codex `exec --json` never emits its model, so surface a display-only model:
// request model, else configured default. Never changes which model codex runs;
// a future codex that streams a model overrides (emitted first → reducer keeps latest).
const displayModel = req.model ?? configModel();
if (displayModel !== undefined) ctx.onProgress?.({ model: displayModel });
```

And **de-lie the fixture** — remove the fabricated model so it matches reality:

```diff
-{"type":"thread.started","model":"gpt-5-codex","thread_id":"t1"}
+{"type":"thread.started","thread_id":"t1"}
```

## Why This Works

The model codex *uses* is fully determined by adapter input (`req.model`) or the user's codex
config — neither is in the stream, but both are knowable at the adapter without changing what
codex runs. Emitting it as `onProgress({ model })` reuses the existing harness-neutral progress
path, so the reducer/selectors/UI need no codex special-case. Keeping the translator's `ev.model`
read (emitted earlier than any future stream model) means a later codex version that *does* emit a
model transparently takes precedence.

## Prevention

- **Fixtures must be captured from the real CLI, not hand-authored** — a fabricated field makes a
  green test that proves nothing. When adding/maintaining a harness fixture, capture real NDJSON.
- When a canonical field (model/tokens/tool) is missing for one harness, first confirm whether the
  CLI *emits it at all* (capture + vendor SDK type) before patching the translator — the value may
  have to come from adapter-side metadata, not the stream.
- Display-only metadata that the harness never streams belongs at the **adapter** boundary via
  `onProgress`, layered (`req.x ?? config ?? blank`), never guessed.

## When to Apply

- A per-agent UI field is blank for one harness only.
- Adding or maintaining a `*-stream.ndjson` fixture, or a harness translator's field extraction.
- Considering whether a missing field should be read from the stream vs supplied by the adapter.
