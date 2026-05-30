# Feature: Workflow Run Report

> When a workflow finishes, the user gets a clear, human-readable summary — tokens (in/out), tool calls, durations, and budget usage — broken down by run, phase, and agent.

## Overview

A workflow run already journals nearly everything worth reporting to `~/.workflow/runs/{runId}/events.jsonl` (per-agent input/output tokens, tool calls, models, cached flags, wall-clock timestamps). This feature turns that latent data into a **report** that prints automatically at the end of a foreground run and is re-rendered when attaching `workflow watch <id>` to a finished run. The report is a pure projection over the event stream — almost no new instrumentation, just a fold + a renderer.

## Goals

- Give the author an at-a-glance accounting of what a run cost (tokens) and did (agents, tool calls, time) the moment it finishes — no extra command to remember.
- Break it down by **run → phase → agent** so fan-outs and expensive phases are obvious.
- Show **budget consumption** ("spent X / Y, Z%") for runs that set a budget.
- Stay format-stable enough that the same projection can later feed `--json` / `report.md` without rework.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Entry point | **Auto-print at end of foreground run**; detached runs surface it **on `watch`** |
| Format | **Human terminal table** only (JSON / markdown deferred) |
| Granularity | **Run + phase + agent**; per-tool-call detail behind a verbose flag (future) |
| Cost ($) | **Tokens only** — no per-model price table |
| Budget line | **Persist `budget.total` and show** spent/total/% |

## Data Model

A pure projection, computed from the event stream (or `RunState`):

```ts
interface RunReport {
  runId: string;
  name: string;
  status: "finished" | "running" | "failed";
  startedAt?: number;
  endedAt?: number;
  wallMs?: number;                 // endedAt - startedAt
  totals: {
    agents: number;                // total queued
    cached: number;                // agent-finished.cached === true (replayed, ~0 spend)
    failed: number;
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
  };
  budget?: { total: number | null; spent: number; pct?: number };
  phases: PhaseReport[];           // ordered by first phase-started
  agents: AgentReport[];           // ordered by startedAt
}

interface PhaseReport {
  title: string;
  agents: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  wallMs?: number;                 // last endedAt - first startedAt within phase
}

interface AgentReport {
  label: string;
  phase: string;
  model?: string;
  status: "done" | "failed" | "cached";
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  wallMs?: number;
  queuedMs?: number;               // started - queued (time spent waiting on the semaphore)
}
```

### Terminal layout (sketch)

```
 Run  refactor-imports · finished · 2m14s
 ─────────────────────────────────────────────
 Tokens   in 184.2k · out 51.7k · total 235.9k
 Agents   12  (3 cached, 0 failed)
 Tools    47 calls
 Budget   spent 235.9k / 500k  (47%)

 Phase            agents   in      out     tools   time
 ─────────────────────────────────────────────────────
 Discover            3     22.1k    4.0k     9      18s
 Transform           8    140.0k   42.3k    31    1m40s
 Verify              1     22.1k    5.4k     7      16s

 Agent                  phase       model        in      out    tools   time
 ───────────────────────────────────────────────────────────────────────────
 review:auth.ts         Transform   opus-4-8     21.0k    6.2k     4      14s
 review:db.ts (cached)  Transform   —             —        —       —       —
 ...
```

(Numbers right-aligned, k/M abbreviated, `—` for cached/zero. Color: dim header rows, cached rows dimmed.)

## Implementation Details

### 1. Token split in the reducer (`packages/core/src/events.ts`)
`AgentState` currently collapses `tokens = inputTokens + outputTokens` (events.ts:171). Add `inputTokens`/`outputTokens` fields (keep `tokens` for back-compat). Mirror onto `PhaseState` and `RunState` (`totalInputTokens`/`totalOutputTokens`). Additive, cheap, no event changes.

### 2. Persist budget total
- Add `budgetTotal?: number | null` to the `run-started` event payload (events.ts:25-36) and have `createRuntime` populate it from `budget.total`.
- Reducer stores it on `RunState`.
- Registry writes it into `meta.json` (`RunMeta`) at run-started so a finished run can show the budget line without the live `Budget` object. The post-run `spent` = `totalOutputTokens` (matches how `budget.record` works today — output-only).

### 3. Projection selector
Add `selectRunReport(state: RunState): RunReport` — a pure function (colocated with `selectors.ts` or a new `core/src/report.ts`). Derives phase ordering, per-phase rollups, queued/wall durations from existing timestamps. Unit-tested with `createScriptedRunner()` fixtures — no real agents.

### 4. Renderer (`packages/ui`)
- An Ink `<RunReport>` component rendering the table above, plus a plain-text `renderReportText(report)` for the non-TTY `line-log.ts` fallback.
- **Foreground run**: on `run-finished`, render the report frame after the returned object (execute.ts emits the result; append the report).
- **`watch` on a finished run**: detect terminal status and render the same `<RunReport>` instead of the live three-pane layout. Reuses persisted `events.jsonl` → `reduce` → `selectRunReport`.

### Edge cases
- **Cached/replayed runs**: cached agents show `—` and count toward `cached`, not token totals (their tokens are ~0; budget only re-records output on replay).
- **Approximate tokens**: if any `agent-finished.usage.approximate` is set, annotate the totals with `~`.
- **No budget set**: omit the Budget line entirely (`budget.total === null`).
- **Failed / aborted runs**: still render with `status: failed` and whatever partial data exists.
- **Large fan-outs**: agent table truncates to top-N by tokens with a "+N more" line (per-agent detail is the verbose tier); phase rollups always shown in full.
- **`raw-api` adapter**: `toolEvents: false` → tool counts will be 0; that's correct, not a bug.

## Scope

### MVP
- Token split + budget persistence in core (reducer + run-started + meta).
- `selectRunReport` pure projection with unit tests.
- Ink `<RunReport>` + plain-text fallback.
- Auto-print at end of foreground run.
- Re-render on `watch` of a finished run.

### Future Enhancements
- [ ] `--json` machine output and `report.json` persisted artifact (stable schema already designed above).
- [ ] `report.md` written into the run dir (and a `workflow report <id>` command) for detached/CI grab.
- [ ] Verbose tier: per-tool-call breakdown (name + input) per agent.
- [ ] Best-effort cost estimate via a per-model price table (`$` column), labeled estimate.
- [ ] Per-tool timing / restart counts (needs new events — restart events aren't emitted today).

## Status
**Status:** Spec Complete
**Created:** 2026-05-30
**Priority:** TBD
