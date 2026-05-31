# Plan: Add knip (unused files/deps/exports detection) and fix real findings

## Goal

Add [knip](https://knip.dev) to the monorepo as a configured, runnable check; fix the genuine
findings it surfaces; and explicitly classify + suppress the false positives (with rationale)
so `pnpm knip` exits clean and stays useful as a signal.

## Recalled learnings (Step 1)

- `docs/solutions/developer-experience/vitest-monorepo-build-and-filter-quirks.md`: **build before
  analyzing** in this monorepo — sibling packages resolve via `dist/` (`exports` → `./dist/index.js`),
  so knip's resolver also needs a prior `pnpm build`. Don't use `pnpm --filter` to scope tooling.

## Baseline (knip, no config)

237 "unused files" (≈231 from `repos/` + skill refs), 9 unused deps, 3 unused devDeps,
8 unused exports, 3 unused exported types, 2 config hints.

## Findings triage

### Real — fix

1. **Unused dependency `tokenlens`** in `packages/core/package.json` — no `tokenlens` import in
   `packages/core/src`. Remove.
2. **Unused dependency `@workflow/schema`** in `packages/cli/package.json` — cli `src` never imports
   it (it reaches schema transitively via core/adapters). Remove from cli's direct deps.
3. **Internal-only exports** — used only within their own file, never imported elsewhere:
   - `Artifact` interface (`packages/cli/src/artifacts.ts`) → drop `export`.
   - `ZodLike` interface (`packages/core/src/runtime.ts`) → drop `export` (still structurally
     reachable via the exported `AgentOptions.schema`, so the rolled-up `.d.ts` is unchanged).
4. **Dead docs helpers** (`apps/docs/.vitepress/theme/...`) — exported but never imported by any
   `.vue`/`.ts`: `SPINNER_FRAMES`, `formatTokens`, `formatDuration`, `formatModel`, `agentElapsedMs`,
   `humanizeTool`, `ToolEvent` (tui-replay.ts) and `readPalette` (rough/useRough.ts). Remove the dead
   code.

### False positive — suppress with rationale (not bugs)

- **`packages/workflow` deps** `@anthropic-ai/sdk, acorn, ajv, esbuild, ink, neverthrow, react` +
  devDeps `@workflow/adapters, @workflow/schema, @workflow/ui`: the package is published as a single
  self-contained bundle (`tsup` `noExternal: [/^@workflow\//]`, third-party libs `external`). They're
  genuine **runtime deps of the bundled `dist/cli.js`**, pulled in transitively — knip's source-level
  analysis can't see the bundle. Add to knip `ignoreDependencies` for that workspace.
- **`packages/examples/src/*.workflow.ts`**: CLI entry points run via `defineworkflow run <file>` /
  package scripts, not imported. Declare as knip `entry` for the examples workspace.
- **`memFs` export** (`packages/cli/src/test-support.ts`): intentional, CLAUDE.md-documented public
  test helper → tag `@public`.
- **`repos/**`, `.claude/**`, `.agents/**`, root `_.html`, `_.config.\*`noise**: not workspace
source. Scope knip via`workspaces`+`ignore`.

## Steps

1. Add `knip` devDep (done) + root `knip` / `knip:fix` scripts.
2. Write `knip.json`: per-workspace config, entry points, `ignore`, `ignoreDependencies`,
   `ignoreBinaries` as needed; tag `memFs` `@public`.
3. Apply the four real fixes.
4. `pnpm build` → `pnpm exec knip` until clean; `pnpm typecheck` + `pnpm test` stay green.
5. Commit, push, open PR, compound a learning doc.

## Verification

- `pnpm exec knip` exits 0 with no findings.
- `pnpm build`, `pnpm typecheck`, `pnpm test` all green.
