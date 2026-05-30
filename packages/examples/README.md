# @workflow/examples

Runnable example workflows for the workflow engine.

A **workflow** is a `.ts` script that does `export const meta = {…}` and then calls the
runtime globals (`agent`, `parallel`, `pipeline`, `phase`, `log`, `workflow`, `args`,
`budget`, `z`) — no imports. The runner injects those at execution time and runs the script in
a sandbox, returning its trailing `return` value.

`z` is the engine's zod instance: build a schema with it and pass it as
`agent(prompt, { schema })` to force a structured, validated return value (the typed object,
not raw text).

## Examples

| Script | What it does |
| --- | --- |
| [`src/haiku.workflow.ts`](src/haiku.workflow.ts) | One `agent()` call — asks an agent for a haiku. Spawns a real agent (uses tokens). |
| [`src/vue-newsletter.workflow.ts`](src/vue-newsletter.workflow.ts) | Parallel fan-out: one schema-typed `agent()` per source researches the Vue/Nuxt ecosystem, then curate + write agents synthesize a newsletter. Demonstrates `parallel`, `phase`, `args`, and zod `schema`. Spawns ~11 real agents (uses tokens). |

## Running

The CLI auto-detects an agent harness on your `PATH` (`claude` → `codex` → `copilot` →
`raw-api` fallback). Make sure `@workflow/cli` is built first (`pnpm build`).

```bash
# convenience script in this package
pnpm --filter @workflow/examples haiku

# or run any script by path with the CLI directly
workflow run packages/examples/src/haiku.workflow.ts --yes

# pick a specific adapter / pass args
workflow run packages/examples/src/haiku.workflow.ts --adapter claude --yes
workflow run packages/examples/src/haiku.workflow.ts --args '{"topic":"retries"}' --yes
```

`--yes` skips the consent prompt. Drop it to review `meta` before the run.

Watch / inspect runs:

```bash
workflow list            # past + running runs
workflow watch <run-id>  # attach the UI to a run
```
