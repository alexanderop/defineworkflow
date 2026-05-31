# @workflow/cli

Command-line interface for the workflow engine.

## Test commands

- `pnpm test` — unit suite (free, deterministic). All e2e describe blocks are skipped.
- `pnpm test:e2e` — runs `WORKFLOW_E2E=1 vitest run --project e2e` against whatever harnesses
  are installed on PATH; adapters not present are auto-skipped at the `it` level. Costs tokens.
  Uses the cheapest path: one schema-bearing agent call per adapter, then a resume that is a
  cache hit with no new spawn.

## Example workflows

Runnable example workflows live in `packages/examples/src/` as `*.workflow.ts` files, each
authored with `defineWorkflow` from the `defineworkflow` package:

- `packages/examples/src/haiku.workflow.ts` — minimal single-`agent()` example
- `packages/examples/src/smoke.workflow.ts`
- `packages/examples/src/vue-newsletter.workflow.ts`

Run one by path, e.g. `workflow run packages/examples/src/haiku.workflow.ts --yes`.
