# defineworkflow

> Deterministic, crash-safe multi-agent workflow engine.

A workflow is a TypeScript file that orchestrates coding-agent invocations
(`agent()`, `parallel()`, `pipeline()`) with **durable, replayable execution**:
every agent result is journaled by sequence number, so a crashed run can be
resumed from a checkpoint without re-invoking the model. Scripts run in a VM
sandbox, agents are dispatched through pluggable harness adapters (Claude /
Codex / Copilot CLIs or the raw Anthropic API), and progress streams to a
React + Ink terminal UI.

## Install

```bash
npm install defineworkflow
# or: pnpm add defineworkflow
```

Requires Node.js ≥ 20.

## Write a workflow

```ts
// haiku.workflow.ts
import { defineWorkflow, agent } from "defineworkflow";

export default defineWorkflow({
  name: "haiku",
  description: "Write a haiku about TypeScript",
  harness: "claude",
  async run({ agent, log }) {
    const poem = await agent("Write a haiku about TypeScript.");
    log(poem);
    return poem;
  },
});
```

## Run it

```bash
npx defineworkflow run haiku.workflow.ts
```

Other commands:

```bash
defineworkflow run <script> [--args '{...}'] [--detach] [--yes]
defineworkflow watch <id> | list | resume <id> | stop <id> | save <id>
defineworkflow adapters
defineworkflow <name> [--args ...]   # run a saved workflow by name
```

## Authoring API

`defineworkflow` exports the authoring entrypoint and the runtime primitive
stubs used for type-checking and editor autocomplete:

- `defineWorkflow({ name, description, harness, phases?, whenToUse?, run })`
- `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `workflow()`
- `z` (the engine's zod instance), `args`, `budget`
- types: `AgentOptions`, `HarnessId`, `WorkflowMeta`, …

The primitive imports exist purely for TypeScript/editor support. At execution
time the CLI strips them and injects the live runtime into the sandbox, so the
following are **forbidden** inside a workflow body (they would break journal
replay): `Date.now()`, `Math.random()`, and argless `new Date()`.

A workflow's harness is declared in `meta.harness` and is the single source of
truth — `"claude" | "codex" | "copilot" | "raw-api"`.

## License

[MIT](./LICENSE) © Alexander Opalic
