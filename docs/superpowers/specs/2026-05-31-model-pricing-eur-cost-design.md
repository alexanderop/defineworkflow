# Design: model pricing table + EUR cost + price-update skill

**Date:** 2026-05-31
**Status:** approved (pending spec review)

## Problem

A workflow run spawns coding agents, each consuming tokens. The runtime already
records per-agent `inputTokens` / `outputTokens` and the raw `model` id, and
aggregates them into `RunReport` (`packages/core/src/report.ts`). What's missing
is a way to turn those tokens into **money** — specifically a EUR figure — using a
price table the user can update by hand, with the prices sourced from a single
machine-readable source of truth so they don't drift.

OpenRouter's `GET https://openrouter.ai/api/v1/models` endpoint is that source of
truth: it returns, per model, `pricing.prompt` and `pricing.completion` as **USD
per token** strings. Multiply by `1e6` to get USD per million tokens.

## Goals

- A hand-editable TypeScript price table in the engine, seeded from OpenRouter.
- Pure functions that turn `(modelId, usage)` into a USD and EUR cost.
- A run-level rollup that sums agent costs and is honest about models it can't price.
- A `update-pricing` skill that refreshes the table from OpenRouter on demand.

## Non-goals (explicitly out of scope for this change)

- No wiring into `RunReport` totals, the printed completion summary, or the Ink
  TUI. `runCostEur` is built ready for a follow-up to call, but nothing consumes it
  yet.
- No live FX lookup. The USD→EUR rate is a manually-edited constant (OpenRouter
  does not provide exchange rates, and a live lookup would be nondeterministic —
  see the sandbox determinism rule in CLAUDE.md). It is _not_ read inside a
  workflow sandbox anyway; cost is computed at the reporting boundary.
- No separate cache-token pricing. The runtime tracks only a `cached: boolean`
  flag, not `cacheRead`/`cacheWrite` token counts, so cache-discounted input
  cannot be computed precisely. Cached (journal-replayed) agents are excluded from
  the cost rollup, matching how `report.ts` already excludes them from token totals.

## Where it lives

`packages/core/src/pricing.ts` — a new module next to `report.ts`. It is pure data
plus pure functions with no new dependencies. `@workflow/core` already owns
`RunReport` / `AgentReport` (which carry `model` + input/output tokens), so cost is
one more pure projection over data the engine already produces. Exported from
`packages/core/src/index.ts`.

## Data model

```ts
interface ModelPriceShape {
  /** OpenRouter canonical id, e.g. "anthropic/claude-opus-4.8". */
  id: string;
  /** Raw harness model ids that map to this entry, e.g. "claude-opus-4-8". */
  aliases: string[];
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
}
export type ModelPrice = Immutable<ModelPriceShape>;
```

Follows the project convention: mutable `…Shape` base + exported `Immutable<Shape>`
(see `events.ts`). `Immutable` / `JsonValue` come from `@workflow/core`'s
`type-ext.ts`, never `type-fest` directly.

```ts
/**
 * USD → EUR conversion rate. Update manually; OpenRouter does not provide FX rates,
 * so the update-pricing skill leaves this line untouched.
 */
export const USD_TO_EUR = 0.92;

// <pricing-table:start> generated from openrouter.ai/api/v1/models — edit via the update-pricing skill
export const MODEL_PRICES: readonly ModelPrice[] = [
  {
    id: "anthropic/claude-opus-4.8",
    aliases: ["claude-opus-4-8"],
    inputPerMTokUsd: 5,
    outputPerMTokUsd: 25,
  },
  {
    id: "anthropic/claude-opus-4.7",
    aliases: ["claude-opus-4-7"],
    inputPerMTokUsd: 5,
    outputPerMTokUsd: 25,
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    aliases: ["claude-sonnet-4-6"],
    inputPerMTokUsd: 3,
    outputPerMTokUsd: 15,
  },
  {
    id: "anthropic/claude-haiku-4.5",
    aliases: ["claude-haiku-4-5"],
    inputPerMTokUsd: 1,
    outputPerMTokUsd: 5,
  },
  // …full Anthropic set from OpenRouter, including legacy models, seeded at build time
];
// <pricing-table:end>
```

**Seed coverage:** the full Anthropic set OpenRouter lists (not just the three
models the current harnesses emit), so older/replayed run reports referencing
legacy models still price correctly.

**Codegen markers:** the `update-pricing` skill rewrites _only_ the lines between
`<pricing-table:start>` and `<pricing-table:end>`. Everything else in the file —
the type, `USD_TO_EUR`, the functions, and the `aliases` for already-known models —
is preserved.

## Model-id matching

The id recorded on an event (`events.ts:76`, e.g. `"claude-opus-4-8[1m]"`) does not
equal OpenRouter's (`"anthropic/claude-opus-4.8"`). Matching must normalize both
sides, and an unknown model must return **`undefined`, never a silent €0**.

`findPrice(modelId: string): ModelPrice | undefined`:

1. Lowercase; strip a trailing bracket tag `[...]` (the `[1m]` context marker).
2. Strip a leading `anthropic/` if present.
3. Strip a trailing date stamp (`-20251001`).
4. Normalize version separators so `claude-opus-4-8` and `claude-opus-4.8` compare
   equal (replace `-(\d+)-(\d+)` → `-$1.$2`).
5. Return the first entry whose normalized `id` (sans `anthropic/`) or any
   normalized `alias` equals the normalized input; else `undefined`.

## Public functions

All pure, no I/O, deterministic.

```ts
/** Per-call USD cost. undefined when the model isn't in the table. */
function costUsd(
  modelId: string,
  usage: { inputTokens: number; outputTokens: number },
): number | undefined;

/** Per-call EUR cost = costUsd × USD_TO_EUR. undefined when the model isn't priced. */
function costEur(
  modelId: string,
  usage: { inputTokens: number; outputTokens: number },
): number | undefined;

/**
 * Run-level EUR rollup. Sums non-cached agents' costs; lists the distinct model ids
 * it could not price rather than under-counting silently.
 */
function runCostEur(report: RunReport): { eur: number; unpriced: readonly string[] };
```

`costUsd` formula:
`(inputTokens / 1e6) * inputPerMTokUsd + (outputTokens / 1e6) * outputPerMTokUsd`.

`runCostEur` iterates `report.agents`, skips `status === "cached"` (replays are ≈0
fresh spend, consistent with `report.ts` token rollups), prices each via its
`model`, accumulates EUR, and collects the set of agent `model` ids that returned
`undefined` (including agents with no `model` recorded) into `unpriced`.

## Testing

`packages/core/src/pricing.test.ts` — deterministic vitest unit tests, no network:

- Known model → expected EUR (assert the arithmetic against `USD_TO_EUR`).
- `findPrice` resolves `claude-opus-4-8`, `claude-opus-4-8[1m]`,
  `anthropic/claude-opus-4.8`, and `claude-haiku-4-5-20251001` to the right entry.
- Unknown model → `costUsd`/`costEur` return `undefined`.
- `runCostEur` over a multi-model `RunReport` sums correctly, excludes a `cached`
  agent, and reports an unpriced model id in `unpriced`. Build the report with the
  `@workflow/test-support` factories where possible; otherwise construct a minimal
  `RunReport` literal inline.

## The `update-pricing` skill (built in this change)

A skill (authored with `skill-creator`, following the repo's skill source +
`.claude/skills` mirror convention from memory) that, when invoked:

1. Fetches `https://openrouter.ai/api/v1/models`.
2. Filters models whose `id` starts with `anthropic/`.
3. Converts `pricing.prompt` / `pricing.completion` (USD/token strings) to
   `inputPerMTokUsd` / `outputPerMTokUsd` (`parseFloat × 1e6`).
4. Builds new `MODEL_PRICES` entries, **carrying over the `aliases`** of any model
   already present in the table (so hand-curated harness-id aliases survive a
   refresh); brand-new models get an empty `aliases: []` for the user to fill.
5. Shows a diff of price changes (old → new per model) and flags any model
   currently in the table that OpenRouter no longer lists, **before** writing.
6. Rewrites only the content between the `<pricing-table:start>` / `<pricing-table:end>`
   markers in `packages/core/src/pricing.ts`. Leaves `USD_TO_EUR` and everything
   outside the markers untouched.
7. Reminds the user that `USD_TO_EUR` is manual and not refreshed.

## Files touched

- `packages/core/src/pricing.ts` (new)
- `packages/core/src/pricing.test.ts` (new)
- `packages/core/src/index.ts` (export the new module)
- the `update-pricing` skill (new; source + `.claude/skills` mirror)

## Future follow-ups (not now)

- Call `runCostEur` from the CLI completion summary and/or the Ink TUI to surface a
  live/estimated EUR figure per run.
- Add `cacheRead`/`cacheWrite` token tracking to `AgentUsageShape` to enable
  precise cache-discounted pricing.
