# @workflow/examples

Runnable example workflows for the workflow engine.

A **workflow** is a `.ts` file that imports from `workflow`, exports
`defineWorkflow({ ... })`, and puts executable logic in `run()`. The imports are for
TypeScript/editor support; the runner strips them and injects the live runtime values in a
sandbox.

Use `defineWorkflow` for editor autocomplete and compile-time checks:

```ts
import { agent, defineWorkflow } from "workflow";

export default defineWorkflow({
  name: "haiku",
  description: "Ask an agent to write a haiku",
  harness: "claude",

  async run() {
    const poem = await agent("Write a haiku");
    return { poem };
  },
});
```

That makes `harness` type-safe: only `"claude"`, `"codex"`, `"copilot"`, or `"raw-api"`
are valid.

`z` is the engine's zod instance: build a schema with it and pass it as
`agent(prompt, { schema })` to force a structured, validated return value (the typed object,
not raw text).

## Examples

| Script | What it does |
| --- | --- |
| [`src/haiku.workflow.ts`](src/haiku.workflow.ts) | One `agent()` call — asks an agent for a haiku. Spawns a real agent (uses tokens). |
| [`src/vue-newsletter.workflow.ts`](src/vue-newsletter.workflow.ts) | Parallel fan-out: one schema-typed `agent()` per source researches the Vue/Nuxt ecosystem, then curate + write agents synthesize a newsletter. Demonstrates `parallel`, `phase`, `args`, and zod `schema`. Spawns ~11 real agents (uses tokens). |

## Running

The workflow declares its harness in `meta.harness`; there is no CLI/config override or
auto-detect for a run. Make sure `workflow` is built first (`pnpm build`).

```bash
# convenience script in this package
pnpm --filter @workflow/examples haiku

# or run any script by path with the CLI directly
workflow run packages/examples/src/haiku.workflow.ts --yes

# pass args
workflow run packages/examples/src/haiku.workflow.ts --args '{"topic":"retries"}' --yes
```

`--yes` skips the consent prompt. Drop it to review `meta` before the run.

Watch / inspect runs:

```bash
workflow list            # past + running runs
workflow watch <run-id>  # attach the UI to a run
```
