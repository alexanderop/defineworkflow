---
title: "Running knip in this monorepo: the four built-in false positives and how they're suppressed"
date: 2026-05-31
track: knowledge
category: developer-experience
problem_type: "tooling_config"
module: "monorepo-root"
component: "knip"
tags: ["knip", "unused-code", "dependencies", "exports", "pnpm", "monorepo", "tsup", "bundle", "ci"]
applies_when: "adding/running knip, debugging a knip finding, or deciding whether a knip report is real"
---

# Running knip in this monorepo: the four built-in false positives and how they're suppressed

## Context

`pnpm knip` (configured in `knip.json`, run in CI after `typecheck`) finds unused files,
dependencies, and exports. On this repo a naive run reports ~250 findings — almost all noise.
Four categories are **structural false positives**: knip's static source analysis can't see them,
so they are suppressed by config/convention, **not** "fixed". Know them before you trust or act on
a knip report here.

## Guidance — the four false positives

1. **`packages/workflow`'s dependencies look unused but aren't.** `defineworkflow` is published as a
   single self-contained bundle: `tsup.config.ts` sets `noExternal: [/^@workflow\//]` (bundle the
   workspace packages in) and `external: [...]` for the third-party libs (`@anthropic-ai/sdk`,
   `acorn`, `ajv`, `esbuild`, `ink`, `neverthrow`, `react`). Those externals are genuine **runtime
   deps of the bundled `dist/cli.js`**, pulled in transitively — `src/index.ts`/`src/cli.ts` never
   import most of them, so knip flags them. Suppressed via `workspaces["packages/workflow"].ignoreDependencies`
   (the third-party externals **plus** `@workflow/adapters|schema|ui`, which arrive transitively
   through the bundled `@workflow/cli`/`core`). If you add a new external to the tsup `external`
   list, add it here too.

2. **`packages/examples/*.workflow.ts` are entry points, not dead files.** They're executed via
   `defineworkflow run <file>` (and package scripts), never imported. Declared as
   `workspaces["packages/examples"].entry: ["src/*.workflow.ts"]`. New example workflows are covered
   automatically by the glob.

3. **Intentional but currently-unused exports → tag `@public`.** Knip honours the `@public` JSDoc
   tag and stops reporting the export. Used for `memFs` in `packages/cli/src/test-support.ts` — a
   documented shared test helper (CLAUDE.md) that real tests happen to re-declare locally today.

4. **`repos/`, `.claude/`, `.agents/` are not product source.** `repos/` is read-only vendored
   reference code; `.claude`/`.agents` hold skill fixtures. Listed in top-level `ignore`. (Don't add
   `**/*.html` — knip already skips non-source files and emits a "Remove from ignore" hint.)

## What WAS real (so don't blanket-ignore everything)

The same first run surfaced genuine cruft worth fixing: unused deps `tokenlens` (`@workflow/core`)
and `@workflow/schema` (`@workflow/cli`), and several **internal-only exports** — types/functions
used only within their own file (`Artifact`, `ZodLike`, and the `tui-replay.ts`/`useRough.ts` docs
helpers). The fix for an internal-only export is to **drop the `export` keyword** (it stays
reachable via any exported type that references it; the tsup `.d.ts` rollup inlines it, so the
public type surface is unchanged — verified by `pnpm typecheck`).

## Why This Matters

Three of the four false positives stem from *bundling* and *entry-by-convention*, which no static
analyzer can infer. Without the config, knip is too noisy to act on and someone will eventually
"fix" a real bundle dependency by deleting it, breaking the published `defineworkflow` package.

## When to Apply

- Adding a dependency to `packages/workflow` that's `external` in tsup → also add to `ignoreDependencies`.
- A knip report fires on something you believe is used → check: is it bundled (1), an entry (2),
  intentionally public (3), or vendored (4) before editing source.
- Run order: knip needs each package's `dist/` (sibling resolution via `exports`), so build/typecheck
  first — same caveat as the vitest "build before test" learning.
