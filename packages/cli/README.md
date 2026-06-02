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

## Graph workflows

Use `workflow graph <script-or-name>` to inspect workflow structure without running agents:

```bash
# Graphviz DOT output is the default
workflow graph packages/examples/src/haiku.workflow.ts

# terminal-friendly tree
workflow graph packages/examples/src/haiku.workflow.ts --format ascii

# raw graph data
workflow graph packages/examples/src/haiku.workflow.ts --format json

# rendered SVG, written to a file
workflow graph haiku --format svg --output haiku.svg
```

The target can be a local workflow file or a saved workflow name. Supported formats are `dot`, `ascii`,
`json`, and `svg`; SVG rendering requires Graphviz `dot` on `PATH`. The extractor is static and
best-effort, so dynamic loops, conditionals, dynamic prompts, and unknown nested workflow targets are
included with warnings where possible.
