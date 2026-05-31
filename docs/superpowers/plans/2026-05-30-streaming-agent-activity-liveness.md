# Plan — Streaming Agent Activity & Liveness

- **Date:** 2026-05-30
- **Spec:** `docs/feature-specs` / brainstorm "Streaming Agent Activity & Liveness — Design"
- **Scope:** `packages/core`, `packages/adapters`, `packages/ui`
- **Prior learnings (recall):**
  - Build before `pnpm test` on a fresh tree; run a single package's tests with
    `pnpm exec vitest run packages/<x>` (NOT `pnpm --filter`).
  - Sandbox scripts can't use `Date.now()`; the **UI** is a normal process so the ticker may.

## Goal

Give the TUI a live, glanceable sense of per-agent progress (model · tokens · tool count ·
elapsed), a digested Activity view, and an Outcome recap — fed by a harness-neutral progress
contract that each adapter's StreamTranslator populates.

## Contract (the seam)

- `AgentProgress { tool?: ToolEvent; tokens?: number; model?: string }` (core).
- `RunCtx.onProgress?: (p: AgentProgress) => void` (optional; non-streaming adapters skip it).
- New event `agent-progress { key, tokens?, model?, at }` (coalesced ≤1/sec).
- `agent-tool` is now actually emitted (one per observed tool call).
- `agent-finished` gains `model?`.
- `AgentState` += `startedAt?`, `endedAt?`, `model?`, `liveTokens?`. `RunState` += `startedAt?`.

## Slice 1 — Streaming data foundation

1. **events.ts (core):** add `AgentProgress`; add `agent-progress` event; add `model?` to
   `agent-finished`; extend `AgentState`/`RunState`; extend `reduce` (startedAt/endedAt/model/
   liveTokens, monotonic tokens). Export `AgentProgress`. — _test: events.test.ts_
2. **types.ts (core):** add `onProgress?` to `RunCtx`. — typecheck only.
3. **runtime.ts (core):** build `onProgress` in `agent()` that stamps `key`, emits `agent-tool`
   for tools, and coalesces `tokens`/`model` into `agent-progress` (≥1000ms gap; first always
   emits via `-Infinity` seed); track last model + max tokens; pass `model` into `agent-finished`.
   Derive a label from the prompt's first non-empty line when `opts.label` is absent. — _tests:
   runtime.test.ts additions._
4. **process-runner.ts (adapters):** add `onLine?` to `ProcessSpec`; rolling-buffer line split,
   still accumulate full stdout. — _test: process-runner.test.ts + fake._
5. **StreamTranslators:** `claude-stream.ts`, `codex-stream.ts`, `copilot-stream.ts` — pure
   factories `{ push(line): AgentProgress | null; result(): {text,data?,usage,isError?} }`.
   Fixtures under `fixtures/*.ndjson`. — _tests: one per translator._
6. **Adapters:** claude → `stream-json --verbose`; codex → `exec --json`; copilot → keep
   coercion/retry, parse `--output-format json` stream. Each wires `onLine` → translator →
   `ctx.onProgress`, reads final from `translator.result()`. — _update claude/codex/copilot tests._
7. **detect.ts:** `toolEvents: true` for claude/codex/copilot; `reportsTokens: true` for
   codex+copilot; drop `approximate` where real usage exists. — _update detect.test.ts._
8. Persistence is automatic (events flow through `emit`).

## Slice 2 — UI redesign (harness-agnostic)

1. **format.ts/selectors.ts:** `formatDuration`, `formatModel`, `humanizeTool`, `activityDigest`,
   `promptPreview`, `agentRow`, `detailSections`. Keep `detailLines` or replace its callers. —
   _tests: selectors.test.ts, format.test.ts._
2. **App.tsx:** now-ticker (`setInterval` ~250ms while running), inject `now`; pass run elapsed
   from `now - state.startedAt`. Extend input: `⏎` toggles prompt expand; keep `j/k` scroll.
3. **components:** Header (X/Y agents · elapsed · status), AgentsColumn (icon label ⟨model⟩ …
   tok·tools·dur), DetailPane (`detailSections` + scroll indicator), Footer keys. — _render tests._
4. **navigation.ts:** add `expand` toggle state + action. — _test: navigation.test.ts._

## Verification

- `pnpm build` then `pnpm test` green (unit). Per-package: `pnpm exec vitest run packages/<x>`.
- Translators covered by fixture tests; reducer + selectors pure unit tested; render tests for
  panes in running + finished states.

## Out of scope (per spec)

Schema-retry for claude/codex; non-TTY animation; stall detection.
