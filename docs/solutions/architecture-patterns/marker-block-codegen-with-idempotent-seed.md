---
title: "Codegen-marker blocks in source files: rewrite between sentinels, keep the seed idempotent"
date: 2026-05-31
track: knowledge
category: architecture-patterns
problem_type: "codegen_pattern"
module: "core"
component: "pricing"
tags: ["codegen", "skill", "openrouter", "pricing", "markers", "idempotent", "source-of-truth", "data-table"]
applies_when: "embedding a machine-refreshable data table inside a hand-editable TS source file, or writing a skill/script that rewrites part of a checked-in file"
---

# Codegen-marker blocks in source files: rewrite between sentinels, keep the seed idempotent

## Context

`packages/core/src/pricing.ts` holds a `MODEL_PRICES` table that is *both* hand-editable (the
`ModelPrice` type, the `USD_TO_EUR` constant, curated `aliases`) and machine-refreshable (prices come
from OpenRouter's `GET /api/v1/models`, USD-per-token × 1e6 → USD-per-Mtok). The `update-pricing`
skill regenerates the table on demand. The design problem: refresh the data without clobbering the
curated parts, and without producing noisy diffs.

## Guidance

**1. Delimit the generated region with comment sentinels and rewrite only between them.** Use
`// <pricing-table:start>` / `// <pricing-table:end>`. The generator slices
`source.slice(0, indexOf(START)) + newBlock + source.slice(indexOf(END) + END.length)`. Everything
outside (types, functions, the manual `USD_TO_EUR` FX rate) is untouched by construction.

**2. Guard the END marker with `indexOf(END) === -1`, not `indexOf(END) + END.length === -1`.** The
latter can never be `-1`, so a missing/renamed END marker silently splices garbage instead of failing
fast. Compute `endAt = indexOf(END)` once, check *that* for `-1`, then slice at `endAt + END.length`.

**3. Carry over hand-curated fields by parsing the old block before rewriting.** The skill reads the
existing `id → aliases` pairs out of the current marker block and re-attaches them, so a refresh never
drops harness-id aliases; brand-new models get `aliases: []` for a human to fill.

**4. Make the committed seed byte-identical to what the generator emits — sort it the same way.** The
generator sorts entries (`toSorted((a,b) => a.id.localeCompare(b.id))`) and rounds away float noise
(`Math.round(n*1e6)/1e6`, since `parseFloat("0.000004")*1e6 === 3.9999…`). Seed the checked-in table in
that *same* canonical order. Otherwise the first real `update-pricing` run produces a pure-reordering
diff that looks like a real change. Verify idempotency: `--write` over a matching seed must yield a
byte-identical file.

**5. Match models by normalizing both sides.** Harness ids (`claude-opus-4-8[1m]`,
`claude-haiku-4-5-20251001`) don't equal OpenRouter ids (`anthropic/claude-opus-4.8`). Normalize:
lowercase → strip trailing `[...]` tag → strip leading `anthropic/` → strip trailing `-\d{8}` date
stamp → `-(\d+)-(\d+)` → `-$1.$2`. An unknown model returns `undefined`, never a silent €0.

## Why This Matters

A generated block that isn't sorted/rounded like its generator creates churn-only diffs that hide real
price changes and erode trust in the tool. The dead `+length === -1` guard is a real corruption risk.
Both are invisible until someone runs the refresh — capturing them here saves re-deriving the pattern.

## When to Apply

- Embedding any refreshable data table (prices, model lists, generated constants) in a TS source file
  that humans also edit.
- Writing a skill/script that rewrites a region of a checked-in file.

## Notes

- Skills in this repo live in **two byte-identical trees**: `.agents/skills/<name>/` (source) and
  `.claude/skills/<name>/` (mirror). Edit one, `cp` to the other, `diff -rq` to confirm.
- Determinism rule (see CLAUDE.md): the FX rate is a manual constant, not a live lookup — cost is
  computed at the reporting boundary, never inside the workflow sandbox.

See also [[type-fest-structural-immutability-vocabulary]] (the `…Shape` + `Immutable<Shape>` pattern
`ModelPrice` follows).
