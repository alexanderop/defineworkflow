# Plan: model pricing table + EUR cost + update-pricing skill

**Date:** 2026-05-31
**Branch:** `claude/happy-carson-g3SLv`
**Spec:** approved design (model pricing table + EUR cost + price-update skill)

## Recalled learnings (Step 1)

- `docs/solutions/developer-experience/vitest-monorepo-build-and-filter-quirks.md`:
  - Run `pnpm build` before `pnpm test` on a fresh tree (e2e files import cross-package `dist/`).
  - Run a single package's tests via `pnpm exec vitest run packages/core`, **not** `pnpm --filter`.
- No prior learning about pricing/cost/OpenRouter.

## Goal

Add a pure, hand-editable model price table + cost projections to `@workflow/core`, plus an
`update-pricing` skill that refreshes the table from OpenRouter. No wiring into reports/UI (follow-up).

## Tasks (TDD per task)

1. **`packages/core/src/pricing.ts`** — new pure module:
   - `ModelPriceShape` interface + `export type ModelPrice = Immutable<ModelPriceShape>`.
   - `export const USD_TO_EUR = 0.92` (manual, untouched by the skill).
   - `MODEL_PRICES` between `// <pricing-table:start>` / `// <pricing-table:end>` markers, seeded
     with the full Anthropic set from OpenRouter (15 models, incl. legacy + `-fast` variants).
   - `findPrice(modelId)`: normalize (lowercase → strip `[...]` → strip `anthropic/` → strip
     `-\d{8}` date stamp → `-(\d+)-(\d+)`→`-$1.$2`), match normalized id-sans-anthropic or any
     normalized alias; else `undefined`.
   - `costUsd`, `costEur` (×`USD_TO_EUR`), `runCostEur(report)` →
     `{ eur, unpriced }` skipping `status === "cached"`, collecting unpriceable model ids.

2. **`packages/core/src/pricing.test.ts`** — deterministic vitest, no network:
   - known model → expected EUR arithmetic; `findPrice` resolves the 4 id forms; unknown →
     `undefined`; `runCostEur` sums, excludes cached, surfaces an unpriced id.

3. **`packages/core/src/index.ts`** — export the pricing module.

4. **`update-pricing` skill** — source under `.agents/skills/update-pricing/` + identical mirror
   under `.claude/skills/update-pricing/` (repo convention: the two trees are kept byte-identical).
   Fetch OpenRouter → filter `anthropic/` → convert USD/token → USD/Mtok → carry over existing
   aliases → show diff + flag removed models → rewrite only between the markers → remind that
   `USD_TO_EUR` is manual.

## Verification

- `pnpm build` then `pnpm exec vitest run packages/core` (path filter, not `--filter`).
- `pnpm lint` + `pnpm typecheck`.

## Out of scope

RunReport/CLI/TUI wiring, live FX, cache-token pricing (per spec non-goals).
