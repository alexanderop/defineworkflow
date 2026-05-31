# defineworkflow

> Deterministic, crash-safe multi-agent workflow engine.

Author a workflow as a single TypeScript file — or a small folder of files —
orchestrate coding-agent invocations with `agent()` / `parallel()` /
`pipeline()`, and get **durable, replayable execution** for free: every agent
result is journaled by sequence number, so a crashed or paused run resumes from
its last checkpoint without re-invoking the model. Scripts run in a VM sandbox,
agents are dispatched through pluggable harness adapters (Claude / Codex /
Copilot CLIs or the raw Anthropic API), and progress streams to a React + Ink
terminal UI.

```ts
// haiku.workflow.ts
import { agent, defineWorkflow, log, phase } from "defineworkflow";

export default defineWorkflow({
  name: "haiku",
  description: "Ask an agent to write a haiku about durable workflows",
  harness: "claude",
  phases: [{ title: "Write" }],

  async run() {
    phase("Write");
    log("asking the agent for a haiku…");

    const poem = await agent(
      "Write a haiku about durable, crash-safe workflows. Return only the haiku.",
      { label: "haiku-writer", phase: "Write" },
    );

    return { poem };
  },
});
```

```bash
defineworkflow run haiku.workflow.ts --yes
```

## Install

Requires **Node.js ≥ 20**. Add it to your project with whichever package
manager you use:

```bash
npm install defineworkflow
pnpm add defineworkflow
yarn add defineworkflow
bun add defineworkflow
```

This gives you the `defineWorkflow` authoring API (for editor types and
type-checking your `*.workflow.ts` files) and the `defineworkflow` CLI.

Run the CLI through your package manager…

```bash
npx defineworkflow run haiku.workflow.ts --yes      # npm
pnpm defineworkflow run haiku.workflow.ts --yes     # pnpm
yarn defineworkflow run haiku.workflow.ts --yes     # yarn
bunx defineworkflow run haiku.workflow.ts --yes     # bun
```

…or install it globally so `defineworkflow` is on your `PATH`:

```bash
npm install -g defineworkflow
pnpm add -g defineworkflow
```

## Why

LLM agents are non-deterministic and expensive to call. A long, multi-step
agentic process that dies halfway through shouldn't have to start over — and
re-running it shouldn't re-spend tokens on work that already succeeded.

`defineworkflow` makes the *orchestration* deterministic while the *agents* stay
probabilistic:

- **Durable & crash-safe** — each `agent()` result is appended to a per-run
  journal. Resume replays the journal by sequence number and only invokes the
  model for steps that never completed.
- **Structured fan-out** — `parallel()` and `pipeline()` express concurrent and
  staged agent work, bounded by a semaphore.
- **Harness-neutral** — the same workflow runs against the Claude, Codex, or
  Copilot CLIs, or the raw Anthropic API, selected by one `harness` field.
- **Typed outputs** — `import { z } from "defineworkflow"` and pass a zod schema
  to `agent({ schema })`; the result is validated (with repair/retry) and typed
  at the call site. Import `z` from `defineworkflow`, not `zod` — the sandbox
  injects it.
- **Budgets & caps** — soft token budgets and agent-count caps keep runaway runs
  in check.
- **Live TUI** — a React + Ink dashboard streams phases, agents, and per-agent
  token accounting as the run progresses.

## Authoring a workflow

A workflow is a TS file whose default export is `defineWorkflow({ ..., run() })`.
The runtime hands `run()` these primitives (also importable from
`defineworkflow` for editor types and autocomplete):

| Primitive | Purpose |
| --- | --- |
| `agent(prompt, opts?)` | Invoke a coding agent; returns its text, or a typed object when `opts.schema` is given |
| `parallel(thunks)` | Run agent calls concurrently (barrier — awaits all) |
| `pipeline(items, ...stages)` | Run each item through staged agent calls, no barrier between stages |
| `phase(title)` | Group subsequent agents under a phase in the UI |
| `log(message)` | Emit a progress line to the user |
| `askUserQuestion(opts)` | Ask the human a question mid-run and await the answer (journaled, so resume never re-asks) |
| `workflow(name, args?)` | Run another workflow inline (one level deep; shares the budget) |
| `budget` | Token budget: `total`, `spent()`, `remaining()` |
| `args` | The value passed via `--args` |

These exist as importable stubs purely for TypeScript/editor support. At
execution time the CLI strips the `import … from "defineworkflow"` line and
injects the live runtime into the sandbox.

`agent(prompt, opts?)` accepts these `opts`: `schema` (zod → typed output),
`label` and `phase` (UI grouping), `model`, `agentType`, `adapter` (per-call
backend override), `isolation: "worktree"` (run the agent in a throwaway git
worktree), and `instructions` (a persona/system hint prepended to the prompt).

The `harness` field (`"claude" | "codex" | "copilot" | "raw-api"`) is **required**
and is the single source of truth for which backend runs — there is no
auto-detect and no CLI override. `defineWorkflow` makes it type-safe, so `tsc`
rejects typos before the CLI runs.

The other `meta` fields are `name`, `description`, `phases`, and two optional
ones:

- `whenToUse?: string` — a hint shown in the saved/bundled workflow list.
- `output?: string` — a directory to persist the run's return value into.
  When set, `result.json` holds the value verbatim and each top-level string
  field is also written to its own file (extension sniffed from content). When
  omitted, the return value is only printed to the terminal.

### Single file or multi-file

A workflow can be **one file** or a **folder**. Pick whichever fits — the CLI
runs both the same way (`defineworkflow run <path>`).

**Single file** — everything in one `*.workflow.ts`. Best for small workflows;
this is the `haiku.workflow.ts` shown at the top of this README.

**Multi-file** — a slim *entry* file that exports `defineWorkflow({...})`, plus
local helper files (schemas, prompts, …) imported with **relative paths**, so the
entry reads like a table of contents:

```
multi-file-haiku/
├── haiku.workflow.ts   # the entry — `export default defineWorkflow({...})`
├── schemas.ts          # `export const HaikuSchema = z.object({ … })`
└── prompts.ts          # `export function haikuPrompt(topic) { … }`
```

```ts
// haiku.workflow.ts
import { agent, defineWorkflow } from "defineworkflow";
import { HaikuSchema } from "./schemas";
import { haikuPrompt } from "./prompts";

export default defineWorkflow({
  name: "multi-file-haiku",
  description: "Schema + prompt live in sibling files; the entry is a table of contents.",
  harness: "claude",
  phases: [{ title: "Write" }],

  async run() {
    const result = await agent(haikuPrompt("a deterministic workflow engine"), {
      label: "haiku",
      phase: "Write",
      schema: HaikuSchema,
    });
    return result;
  },
});
```

```bash
defineworkflow run multi-file-haiku/haiku.workflow.ts --yes
```

Rules to keep in mind:

- Imports are restricted to **local relative files** + `"defineworkflow"`. npm
  imports are rejected at bundle time — this is what keeps the sandbox
  deterministic by construction.
- Schemas may live at a helper file's top level (`export const X = z.object({…})`)
  — they no longer have to be declared inside `run()`.
- Before running, the CLI **bundles** the entry's local imports into one
  self-contained source (esbuild, with `defineworkflow` external). That bundle is
  what gets snapshotted to the registry, so `save` / `resume` / `--detach` are all
  self-contained.
- `meta` still lives in the entry's `defineWorkflow({...})` call as a pure literal.
- **Known limitation:** a nested `workflow("name")` target must be single-file or
  an already-saved workflow; a hand-placed multi-file nested workflow isn't bundled
  by the nested resolver.

### Sandbox constraints

Scripts execute in a Node `vm` sandbox. To keep journal replay deterministic,
`Date.now()`, `Math.random()`, and argless `new Date()` are **forbidden** inside
a workflow body. Pass timestamps in via `args` and stamp results after the run
returns.

## CLI

```
defineworkflow run <script> [--args '{...}'] [--answers '{...}'] [--detach] [--yes] [--mock]
defineworkflow watch <id>          # tail a running/finished run
defineworkflow list                # list runs (status, tokens, elapsed)
defineworkflow resume <id>         # replay from journal and continue live
defineworkflow stop <id>           # stop a backgrounded run
defineworkflow save <id>           # save a run's script as a named workflow
defineworkflow adapters            # list detected harnesses + capabilities
defineworkflow <name> [--args ...] # run a saved/bundled workflow by name
```

- `--mock` runs the whole workflow against a fabricating runner: every `agent()`
  returns schema-valid dummy data, so you can iterate on control flow, phases,
  and the UI with **no agents spawned and no tokens spent**.
- `--answers '{"<key>":"<value>"}'` pre-supplies answers for `askUserQuestion()`
  calls, keyed by each question's `key`. This is the headless story: a
  non-TTY / `--detach` / CI run resolves each question from this map, then the
  question's `default`, else fails fast rather than hanging on input.
- `--detach` spawns a headless child you tail with `watch`.
- Runs are persisted under `~/.workflow/runs/{runId}/` as events + journal JSONL.
- A consent gate guards real runs; `--yes`, non-TTY/CI, or saved consent
  auto-allow.

## License

[MIT](./LICENSE) © Alexander Opalic
