# Streaming Agent Activity & Liveness — Design

- **Date:** 2026-05-30
- **Status:** Approved (brainstorm) → ready for implementation plan
- **Scope:** `packages/adapters`, `packages/core`, `packages/ui`
- **Related:** `2026-05-29-deterministic-workflow-orchestrator-design.md`

## Problem

When a workflow runs, the TUI shows `running · 0 tok · 0s` and every agent stuck on
`started` for the entire duration. Two causes:

1. The header's elapsed time is derived from the _last event's_ timestamp, and no
   events arrive during a long `claude -p` call — so the clock visibly freezes.
2. The claude adapter uses `--output-format json` (non-streaming): it emits nothing
   until the process exits, so there are no intermediate tokens, tool calls, or
   progress to show. `AgentState.tools` exists but is never populated.

The user can't tell a healthy run from a hung one, and there's no sense of _what_ an
agent is doing. (This is what made the stdin-hang bug feel like "nothing happens".)

## Goals

- A live, glanceable sense of progress per agent: **model · tokens · tool count ·
  elapsed**, updating while the agent runs.
- A digested **Activity** view (last N tool calls, humanized) — never a raw firehose.
- A per-agent **Outcome** recap on completion.
- Works across **all three installed harnesses** (claude, codex, copilot) with an
  identical UI.

## Non-goals / explicit decisions

- **No raw tool-call streaming in the detail view.** Always digested (last 3 of N).
- **Schema reliability** (claude `--json-schema` sometimes returns prose instead of
  `structured_output`) is a _separate_ known bug. Streaming does not fix it; the
  coercion/retry fix is a follow-up, not part of this spec.
- **Non-TTY line-log** does not get the live animation. It gets only a per-agent final
  recap line. (Future: optional periodic heartbeat line.)
- **False liveness accepted:** the elapsed timer ticks from wall-clock, so a genuinely
  hung process still shows rising seconds. We do not add stall detection in v1.

## Target UI (from approved mockups)

The TUI has two navigation levels under a persistent header + footer:

- **List level** — `Phases` column on the left, the selected phase's `Agents` column
  on the right. `↑↓` selects an agent; `Enter`/`→` drills in.
- **Detail level** — the `Agents` column narrows to a spine on the left, and the right
  pane becomes the per-agent detail. `Esc`/`←` goes back.

### View 1 — list level, a run in progress

The header clock ticks; the running agent shows a spinner and **live** `tok · tools`.

```
╭────────────────────────────────────────────────────────────────────────────────────────╮
│ alexop-this-month                                                      0/1 agent · 21s   │
│ Find and summarize posts published on alexop.dev this month (May 2026)                   │
╰────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Phases ───────────╮╭─ Discover · 1 agent ─────────────────────────────────────────────╮
│                    ││                                                                  │
│ › 1 Discover  0/1  ││ ⠙ Use the WebFetch tool (…    Opus 4.8 (1M)  20.4k tok · 5 tools │
│   2 Summarize      ││                                                                  │
│                    ││                                                                  │
╰────────────────────╯╰──────────────────────────────────────────────────────────────────╯
 ↑↓ select · esc back · s save
```

### View 2 — drill into an agent: the detail pane

Sectioned and scrollable. Prompt is collapsed (`⏎` expands); Activity is the digest
(last 3 of N, humanized); Outcome is the result. Scroll indicator at bottom-right.

```
╭─ Discover · 1 agent ─────╮╭─ Use the WebFetch tool (search… ───────────────────────────╮
│                          ││ ✓ Completed · Opus 4.8 (1M context)                        │
│ › ✓ Use the WebFetch (s… ││ 21k tok · 6 tool calls · 30s                               │
│                          ││                                                            │
│                          ││ Prompt · 9 lines · ⏎ expand                                │
│                          ││   Use the WebFetch tool (…) to fetch these URLs and        │
│                          ││   find every blog post PUBLISHED IN MAY 2026 on alexop.de… │
│                          ││   … 7 more lines                                           │
│                          ││                                                            │
│                          ││ Activity · last 3 of 6 tool calls                          │
│                          ││   WebFetch(List all blog posts with titles, URLs…)         │
│                          ││   WebFetch(List EVERY post published in May 2026…)         │
│                          ││   StructuredOutput                                         │
│                          ││                                                            │
│                          ││ Outcome                                                    │
│                          ││   Found 2 posts published in May 2026 on alexop.dev:       │
│                          ││   1. "Claude Code Workflows: Deterministic Multi-Agent…"   │
╰──────────────────────────╯╰────────────────────────────────────────────────────────────╯
 ↑↓ agent · j/k scroll · ⏎ prompt · p pause · esc back · s save               1–17 of 21 ↓
```

### View 3 — list level, run finished

Spinners resolve to `✓`/`✗`; rows freeze at final `tok · tools · duration`; header shows
`done` and total elapsed.

```
╭────────────────────────────────────────────────────────────────────────────────────────╮
│ alexop-this-month                                                3/3 agents · 50s · done │
│ Find and summarize posts published on alexop.dev this month (May 2026)                   │
╰────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Phases ───────────╮╭─ Summarize · 2 agents ───────────────────────────────────────────╮
│                    ││                                                                  │
│ ✓ Discover  1/1    ││ ›✓ summarize:Claude Cod…  Opus 4.8 (1M)  20k tok · 3 tools · 18s │
│ ✓ Summarize 2/2    ││  ✓ summarize:How to do …  Opus 4.8 (1M)  20k tok · 3 tools · 20s │
│                    ││                                                                  │
╰────────────────────╯╰──────────────────────────────────────────────────────────────────╯
 ↑↓ select · esc back · s save
```

### Where each datum comes from

| UI element                        | Source (via the contract)                                  |
| --------------------------------- | ---------------------------------------------------------- |
| spinner / `✓` / `✗`               | `AgentState.status` + the UI tick                          |
| `20.4k tok` (live) → final        | `agent-progress.tokens` → `agent-finished.usage`           |
| `5 tools` / Activity list         | `agent-tool` events → `AgentState.tools`                   |
| `Opus 4.8 (1M context)`           | `agent-progress.model` → `formatModel(id)`                 |
| `· 21s` / `· 18s`                 | `now − startedAt` (running) / `endedAt − startedAt` (done) |
| Prompt / `… N more lines`         | `AgentState.prompt` → `promptPreview()`                    |
| Outcome                           | `AgentState.resultText`                                    |
| `0/1 agent` · `3/3 agents · done` | `RunState` phase/agent counts + `status`                   |

## Architecture: normalization boundary at the adapter

All three CLIs emit newline-delimited JSON event streams, but with **different
taxonomies**. Each adapter owns a **StreamTranslator** that maps its native events into
one shared, harness-neutral progress contract. The runtime forwards those as
`agent-tool` / `agent-progress` events keyed by agent. **The reducer, selectors, and
UI are 100% harness-agnostic** and never learn which CLI produced the stream.

```
claude  stream-json ─┐
codex   exec --json ─┼─► StreamTranslator ─► ctx.onProgress({tool?, tokens?, model?})
copilot --format json┘                              │
                                                     ▼
                              runtime → emit agent-tool / agent-progress (keyed)
                                                     ▼
                                reduce → RunState → selectors → Ink panes
```

Confirmed native envelopes (probed 2026-05-30):

| Harness | Flag                                    | Model from          | Live tokens from                                 | Tool calls from                                                        | Final from                              |
| ------- | --------------------------------------- | ------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------- |
| claude  | `--output-format stream-json --verbose` | `system/init.model` | `assistant.message.usage.output_tokens`          | `assistant` `tool_use` content blocks                                  | `result` (usage + `structured_output`)  |
| codex   | `exec --json`                           | thread/turn init    | `turn.completed`                                 | `item.completed` (`item.type` = `command_execution` / `mcp_tool_call`) | `turn.completed` + `agent_message` item |
| copilot | `--output-format json`                  | `session.*`         | `assistant.message_delta` / `assistant.turn_end` | `assistant` tool-call events                                           | `result`                                |

Noise each translator must skip: claude `hook_started`/`hook_response`/`rate_limit_event`/
`notification`; codex `thread.started`/`turn.started`; copilot `session.*`.

## The contract (the seam between Slice 1 and Slice 2)

**`ToolEvent`** (already exists, harness-neutral): `{ name: string; input?: unknown }`.

**New progress sink on `RunCtx`:**

```ts
interface AgentProgress {
  readonly tool?: ToolEvent; // a tool call just observed
  readonly tokens?: number; // cumulative output tokens so far
  readonly model?: string; // raw model id, e.g. "claude-opus-4-8[1m]"
}
interface RunCtx {
  readonly runId: string;
  readonly seq: number;
  readonly onProgress?: (p: AgentProgress) => void; // NEW (optional)
}
```

Adapters that can't stream simply never call `onProgress`; everything still works,
just without live updates.

**Events** (`core/events.ts`):

- `agent-tool` `{ key, tool, at }` — _now actually emitted_ (one per tool call).
- **new** `agent-progress` `{ key, tokens?, model?, at }` — coalesced to ≤1/sec.
- `agent-finished` gains `model?: string`.

**State** (`core/events.ts`):

- `AgentState` += `startedAt?`, `endedAt?`, `model?`, `liveTokens?` (`tools` already present).
- `RunState` += `startedAt?`.
- `reduce` sets `startedAt` from `agent-started.at`, `endedAt` from
  `agent-finished`/`agent-failed.at`, `model`/`liveTokens` from `agent-progress`, and
  appends `agent-tool` to `tools`.

## Slice 1 — Streaming data foundation

### 1.1 ProcessRunner: incremental output

`createProcessRunner` currently buffers all stdout and resolves on `close`. Add an
optional `onLine?: (line: string) => void` to `ProcessSpec`. Implementation keeps a
rolling buffer, splits on `\n`, and invokes `onLine` per complete line while still
accumulating the full `stdout` for the final `ProcessOutput` (back-compat). The
stdin-close fix stays. Unit test: feed a fake child that writes 3 lines over time →
`onLine` called 3× in order, final `stdout` still complete.

### 1.2 RunCtx.onProgress wiring (runtime)

`agent()` constructs `ctx = { runId, seq: mySeq, onProgress }` where `onProgress`
stamps the agent `key` and emits:

- `tool` → `agent-tool`
- `tokens`/`model` → `agent-progress`, **coalesced**: keep last-emitted timestamp per
  agent; drop a progress update if < ~1000ms since the last _persisted_ one (always
  keep the final state via `agent-finished`). Token monotonicity preserved.

### 1.3 StreamTranslators (one per adapter)

Each adapter spawns with its streaming flag, passes `onLine` to the ProcessRunner, and
runs a small pure translator `(line) => AgentProgress | null` plus terminal extraction
(final text + schema data + usage). Translators are pure and unit-tested against
captured fixture streams (one `.ndjson` fixture per harness under `fixtures/`).

- **claude.ts** → `stream-json --verbose`; `system/init`→model, `assistant`
  `tool_use`→tool, `assistant.usage`→tokens, `result`→final (usage + `structured_output`).
- **codex.ts** → `exec --json`; `item.completed` with tool-ish `item.type`→tool,
  `agent_message` item→text, `turn.completed`→tokens/final.
- **copilot.ts** → `--output-format json`; tool-call events→tool,
  `message_delta`→tokens, `result`→final. Keep existing schema coercion/retry.

### 1.4 Capabilities

`detect.ts` `CAPABILITIES`: set `toolEvents: true` for claude/codex/copilot; set
`reportsTokens: true` for codex and copilot (their turn/result events carry real usage,
replacing today's `approximate` estimate). Drop `approximate` where real usage exists.

### 1.5 Persistence

`agent-tool` and coalesced `agent-progress` are persisted to `events.jsonl` like any
event (≤1/sec keeps volume modest, ~50 lines for a 50s agent), so detached `watch`
also gets liveness. The journal (success-only, separate file) is unaffected — progress
events are not journaled and do not influence replay/determinism.

### Slice 1 verification

A headless run's `events.jsonl` shows, per agent: `agent-started` → `agent-tool`×N →
rising `agent-progress` tokens (with `model`) → `agent-finished` carrying `model`.
Translators covered by fixture-based unit tests for all three harnesses.

## Slice 2 — UI redesign (harness-agnostic)

### 2.1 now-ticker (`App.tsx`)

A `setInterval(~250ms)` bumps a `tick` state while `RunState.status === "running"`,
cleared on finish. Drives spinner frames and elapsed. `now = Date.now()` (the UI is a
normal process — the `Date.now()` sandbox ban only applies inside the workflow VM).
Plays with the existing 100ms render throttle.

### 2.2 selectors (`ui/selectors.ts`) — all pure, `now` injected

- `formatDuration(ms)` → `m:ss` (`0:43`) or `Ns` for sub-minute as in mockups.
- `formatModel(id)` → friendly name, e.g. `claude-opus-4-8[1m]` → `Opus 4.8 (1M context)`
  via a small known-id map with a graceful fallback to the raw id.
- `humanizeTool(tool)` → `Name(firstArgPreview…)`; truncate; special-case
  `StructuredOutput` (the schema return) and arg-less tools (show bare name).
- `activityDigest(agent, k=3)` → `{ shown: humanized[], total }` ("last 3 of 6").
- `promptPreview(prompt, expanded, headLines=2)` → first lines + `… N more lines`,
  or full when expanded.
- `agentRow(agent, now)` → `{ icon, label, model, tokens, toolCount, elapsed }`
  (icon: spinner while running, `✓`/`✗` terminal).
- `detailSections(agent, now, expanded)` → flat `string[]` lines for the scrollable
  pane: Status, Metrics, **Prompt**, **Activity**, **Outcome**.

### 2.3 components

- **Header.tsx** — `name` / `description` / right: `X/Y agents · {runElapsed} · {status}`.
- **AgentsColumn.tsx** — rows: `icon label  ⟨dim model⟩` left, `{tok · tools · dur}`
  right-aligned; truncate label to fit.
- **DetailPane.tsx** — render `detailSections`; section headers styled; `⏎` toggles
  prompt expand; keep scroll window; show `a–b of N ↓` indicator.
- **Footer** — contextual keys: list `↑↓ select · esc back · s save`; detail
  `↑↓ agent · j/k scroll · ⏎ prompt · p pause · esc back · s save`. Extends existing
  `navigation.ts` (add `j/k` scroll + `⏎` expand in detail focus).
- **label-from-prompt** (runtime `agent()`): when `opts.label` absent, derive label
  from the prompt's first non-empty line (truncated) instead of `agent-${seq}`, so
  unlabeled agents read like the mockup's "Use the WebFetch tool (…".

### Slice 2 verification

Render tests (ink-testing-library) with fixed `RunState` + fixed `now` snapshot each
pane in running and finished states; selector unit tests cover humanize/digest/preview/
format edge cases (empty tools, long prompt, unknown model id, arg-less tool).

## Testing strategy

- **Pure first:** reducer (new fields), selectors, and the three translators are pure
  and get direct unit tests (translators against captured `.ndjson` fixtures).
- **ProcessRunner** incremental `onLine` test with a scripted fake child.
- **Render** tests for the three panes + footer in both run states.
- **e2e** (gated `WORKFLOW_E2E=1`): one real claude run asserting `events.jsonl`
  contains `agent-tool` and `agent-progress` with rising tokens.

## Risks / follow-ups

- **Schema flakiness** (out of scope): claude/codex sometimes return prose instead of
  structured output. Follow-up: give the claude adapter copilot-style
  `runWithSchemaRetry` + `extractJson` coercion.
- **Stream parse drift:** CLI event taxonomies can change across versions; isolating
  each in a tested translator with fixtures contains the blast radius.
- **Token-field precision** for codex/copilot is pinned at implementation from the
  fixtures (claude is confirmed).

## Open decisions (resolved)

- Persist coalesced `agent-progress` ~1/sec — **yes**.
- Schema-retry — **separate follow-up**.
- Non-TTY animation — **out of scope** (final recap line only).
