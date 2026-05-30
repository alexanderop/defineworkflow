# workflow

> Deterministic, crash-safe multi-agent workflow engine.

Author a workflow as a single TypeScript file, orchestrate coding-agent
invocations with `agent()` / `parallel()` / `pipeline()`, and get **durable,
replayable execution** for free: every agent result is journaled by sequence
number, so a crashed or paused run resumes from its last checkpoint without
re-invoking the model.

```ts
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
workflow run haiku.workflow.ts --yes
```

## Why

LLM agents are non-deterministic and expensive to call. A long, multi-step
agentic process that dies halfway through shouldn't have to start over — and
re-running it shouldn't re-spend tokens on work that already succeeded.

`workflow` makes the *orchestration* deterministic while the *agents* stay
probabilistic:

- **Durable & crash-safe** — each `agent()` result is appended to a per-run
  journal. Resume replays the journal by sequence number and only invokes the
  model for steps that never completed.
- **Structured fan-out** — `parallel()` and `pipeline()` express concurrent and
  staged agent work, bounded by a semaphore.
- **Harness-neutral** — the same workflow runs against the Claude, Codex, or
  Copilot CLIs, or the raw Anthropic API, selected by one `harness` field.
- **Typed outputs** — pass a zod schema to `agent({ schema })` and the result is
  validated (with repair/retry) and typed at the call site.
- **Budgets & caps** — soft token budgets and agent-count caps keep runaway runs
  in check.
- **Live TUI** — a React + Ink dashboard streams phases, agents, and per-agent
  token accounting as the run progresses.

## Install / Quick start

Requires **Node ≥20** and **pnpm ≥11**.

```bash
git clone <this-repo> && cd workflow
pnpm install
pnpm build

# run the bundled example end-to-end (spawns a real Claude agent, uses tokens)
pnpm example

# …or iterate on control flow with no agents and no tokens:
workflow run packages/examples/src/haiku.workflow.ts --mock
```

The public authoring package is published to npm as
[`defineworkflow`](https://www.npmjs.com/package/defineworkflow) — workflow files
`import { ... } from "defineworkflow"` for editor types and autocomplete; the
runner strips those imports and injects the live runtime at execution time.

## Authoring a workflow

A workflow is a TS file whose default export is `defineWorkflow({ ..., run() })`.
The runtime hands `run()` these primitives:

| Primitive | Purpose |
| --- | --- |
| `agent(prompt, opts?)` | Invoke a coding agent; returns its text, or a typed object when `opts.schema` is given |
| `parallel(thunks)` | Run agent calls concurrently (barrier — awaits all) |
| `pipeline(items, ...stages)` | Run each item through staged agent calls, no barrier between stages |
| `phase(title)` | Group subsequent agents under a phase in the UI |
| `log(message)` | Emit a progress line to the user |
| `workflow(name, args?)` | Run another workflow inline (one level deep; shares the budget) |
| `budget` | Token budget: `total`, `spent()`, `remaining()` |
| `args` | The value passed via `--args` |

The `harness` field (`"claude" | "codex" | "copilot" | "raw-api"`) is **required**
and is the single source of truth for which backend runs — there is no
auto-detect and no CLI override. `defineWorkflow` makes it type-safe, so `tsc`
rejects typos before the CLI runs.

### Sandbox constraints

Scripts execute in a Node `vm` sandbox. To keep journal replay deterministic,
`Date.now()`, `Math.random()`, and argless `new Date()` are **forbidden** inside
a workflow body. Pass timestamps in via `args` and stamp results after the run
returns.

## CLI

```
workflow run <script> [--args '{...}'] [--detach] [--yes] [--mock]
workflow watch <id>          # tail a detached run
workflow list                # list runs
workflow resume <id>         # replay from journal and continue
workflow stop <id>
workflow save <id>           # save a run's script as a named workflow
workflow adapters            # probe PATH for available agent CLIs
workflow <name> [--args ...] # run a saved workflow by name
```

- `--mock` runs the whole workflow against a fabricating runner: every `agent()`
  returns schema-valid dummy data, so you can iterate on control flow, phases,
  and the UI with **no agents spawned and no tokens spent**.
- `--detach` spawns a headless child you tail with `watch`.
- Runs are persisted under `~/.workflow/runs/{runId}/` as events + journal JSONL.
- A consent gate guards real runs; `--yes`, non-TTY/CI, or saved consent
  auto-allow.

## Architecture

Dependency direction: `schema` → `core` → `adapters` → `cli`, with `ui`,
`examples`, and `workflow` (the authoring package) at the edges. Packages are
wired by dependency injection, which is what makes them testable with in-memory
fakes.

| Package | Responsibility |
| --- | --- |
| `@workflow/schema` | zod → JSON Schema conversion and validation (the only place that touches `z.toJSONSchema()`) |
| `@workflow/core` | The execution engine: `createRuntime()`, journaling/replay, events, budget, sandbox |
| `@workflow/adapters` | Harness backends (Claude / Codex / Copilot CLIs, raw Anthropic API) behind a uniform `AgentRunner` |
| `@workflow/cli` | The `workflow` binary — run, watch, resume, save, consent, persistence |
| `@workflow/ui` | React + Ink terminal dashboard driven by the event stream |
| `defineworkflow` (`packages/workflow`) | The public authoring entrypoint workflow files import from |
| `@workflow/examples` | Runnable example workflows |

The engine is **event-sourced**: the runtime emits a typed `WorkflowEvent`
stream, and `reduce(state, event)` rebuilds the `RunState` consumed by the UI and
registry. New behavior surfaces through events, not side channels.

**Errors are values.** The codebase threads neverthrow `Result<T, E>` throughout
(`WorkflowError` is a tagged union); inside a workflow body the runtime bridges a
failed `Result` into a thrown error so author code can use normal `try`/`catch`.

## Development

```bash
pnpm build          # build all packages (topological, via tsup)
pnpm typecheck      # build declarations, then tsc --noEmit per package
pnpm lint           # oxlint
pnpm test           # vitest, the "unit" project
pnpm test:watch
pnpm test:e2e       # WORKFLOW_E2E=1 — spawns real agents, uses tokens
```

- Run a single file: `pnpm vitest run packages/core/src/runtime.test.ts`
- Filter by name: `pnpm vitest run packages/core/src/runtime.test.ts -t "nested"`

Tests are **colocated** with source as `*.test.ts(x)`. The vitest workspace
splits them into a `unit` project and an `e2e` project (gated behind
`WORKFLOW_E2E=1`). Use the in-memory test doubles — `createScriptedRunner()`
(`@workflow/core`) and `FakeProcessRunner` (`@workflow/adapters`) — instead of
spawning real CLIs in unit tests.

`lefthook` runs lint + typecheck on **pre-commit** and tests on **pre-push**.

### Stack

pnpm workspaces · ESM-only · TypeScript (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`) · tsup · vitest · oxlint ·
zod · neverthrow · React + Ink.

## License

See repository.
