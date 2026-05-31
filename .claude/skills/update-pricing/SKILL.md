---
name: update-pricing
description: Refresh the model price table in packages/core/src/pricing.ts from OpenRouter's live model list. Use when the user wants to update model prices, refresh MODEL_PRICES, re-seed the pricing table, or pull the latest Anthropic per-token costs into the workflow engine. Rewrites only the generated <pricing-table:start>/<pricing-table:end> block, carries over hand-curated aliases, and leaves USD_TO_EUR untouched.
---

# Update Pricing

## Overview

`packages/core/src/pricing.ts` holds a hand-editable `MODEL_PRICES` table (USD per **million**
tokens) used to turn agent token usage into a EUR cost. This skill refreshes that table from the
single source of truth — OpenRouter's `GET https://openrouter.ai/api/v1/models` — without clobbering
the curated bits.

What it touches and what it never touches:

- **Rewrites only** the lines between `// <pricing-table:start>` and `// <pricing-table:end>`.
- **Preserves** the `ModelPrice` type, the pure functions, the `USD_TO_EUR` constant, and the
  `aliases` of any model already in the table (hand-curated harness-id aliases survive a refresh).
- OpenRouter does **not** provide FX rates, so `USD_TO_EUR` is left alone — remind the user it is
  manual.

## How prices map

OpenRouter reports `pricing.prompt` / `pricing.completion` as **USD per token** strings. The script
converts them to `inputPerMTokUsd` / `outputPerMTokUsd` via `parseFloat × 1e6` (and rounds away
float noise). Only models whose `id` starts with `anthropic/` are kept. Brand-new models get
`aliases: []` for you to fill in with the raw harness id (e.g. `claude-opus-4-8`).

## Steps

1. **From the repo root**, dry-run to preview the diff (fetches OpenRouter, writes nothing):

   ```bash
   node .agents/skills/update-pricing/scripts/update-pricing.mjs
   ```

   The output flags `+ NEW` models, `~ PRICE` changes (old → new), and `! GONE` models OpenRouter no
   longer lists. (Requires outbound network access to `openrouter.ai`.)

2. **Review the diff.** Sanity-check unexpected price swings and any `! GONE` entry before removing
   it — a model dropping off OpenRouter doesn't always mean it should leave the table (older models
   may still appear in replayed run reports).

3. **Apply** when the diff looks right:

   ```bash
   node .agents/skills/update-pricing/scripts/update-pricing.mjs --write
   ```

4. **Fill in aliases** for any `+ NEW` model: open `packages/core/src/pricing.ts` and set its
   `aliases` to the raw harness id(s) (e.g. `["claude-opus-4-9"]`). Existing models keep theirs
   automatically.

5. **Remind the user** that `USD_TO_EUR` is manual and was *not* refreshed — update it by hand if
   the FX rate has moved.

6. **Verify** the table still compiles and prices correctly:

   ```bash
   pnpm exec vitest run packages/core/src/pricing.test.ts
   pnpm lint && pnpm typecheck
   ```

## Notes

- Keep this `SKILL.md` and its `scripts/` mirror byte-identical between `.agents/skills/` and
  `.claude/skills/` (repo convention for skills).
- If the table grows new models, consider adding a test case in `pricing.test.ts` for any whose
  harness id needs an alias that normalization alone can't bridge.
