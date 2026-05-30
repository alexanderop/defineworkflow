# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This is **workflow-monorepo** — a deterministic multi-agent workflow engine. A workflow is a plain
JS/TS script that orchestrates coding-agent invocations (`agent()`, `parallel()`, `pipeline()`) with
durable, crash-safe execution: every agent result is journaled by sequence number, so a run can be
replayed from a checkpoint without re-invoking the model. Scripts run in a VM sandbox, agents are
dispatched through pluggable harness adapters (Claude/Codex/Copilot CLIs or the raw Anthropic API),
and progress is streamed to a React+Ink terminal UI.

pnpm workspaces (pnpm ≥11), ESM-only, Node ≥20. Packages build with **tsup**, test with **vitest**,
lint with **oxlint**, and git hooks run via **lefthook**.

## Build / Test / Lint

- **Build all packages** (topological): `pnpm build`
- **Type-check**: `pnpm typecheck` — builds first (declarations feed dependent packages), then `tsc --noEmit` per package
- **Lint**: `pnpm lint` (oxlint)
- **Test (unit)**: `pnpm test` — vitest run, the `unit` project
- **Watch tests**: `pnpm test:watch`
- **Run a single test file**: `pnpm vitest run packages/core/src/runtime.test.ts`
- **Filter by test name**: `pnpm vitest run packages/core/src/runtime.test.ts -t "nested"`
- **e2e tests**: `pnpm test:e2e` — sets `WORKFLOW_E2E=1` and runs the `e2e` project (these spawn real agents and use tokens)
- **Run the example workflow end-to-end**: `pnpm example` (builds, then runs `packages/examples/src/haiku.workflow.ts` via the CLI — spawns a real Claude agent)

`lefthook` runs `lint` + `typecheck` on **pre-commit** (parallel) and `test` on **pre-push**.

### Test layout & conventions

Tests are **colocated** with source as `*.test.ts(x)` inside each package's `src/`. The vitest workspace
(`vitest.workspace.ts`) splits them into two projects:

- **unit** — `packages/*/src/**/*.test.ts(x)`, excluding `*.e2e.test.ts`
- **e2e** — `packages/*/src/**/*.e2e.test.ts` only (gated behind `WORKFLOW_E2E=1`)

Add a test next to the code it covers. Use the in-memory test doubles instead of real I/O:
`createScriptedRunner()` (`@workflow/core`) for a deterministic `AgentRunner`, and the
`FakeProcessRunner` (`@workflow/adapters`) for adapter tests — don't spawn real CLIs in unit tests.

## TypeScript conventions

`tsconfig.base.json` is **strict** and then some — code must satisfy:
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, and
`verbatimModuleSyntax` (so use `import type { … }` for type-only imports). Module resolution is
`Bundler`; everything is ESM.

**Errors are values, not exceptions.** The codebase uses **neverthrow** `Result<T, E>` throughout.
`@workflow/core` defines a `WorkflowError` tagged union (`AdapterSpawn`, `SchemaValidation`,
`SandboxViolation`, `JournalCorrupt`, `BudgetExhausted`, `AgentCapExceeded`, `HarnessNotDeclared`);
`AgentRunner.run()` and the schema/adapter helpers all return `Result`. Inside a workflow body the
runtime bridges a failed `Result` into a thrown `WorkflowThrow` so author code can use normal
`try/catch`/`await`. Match the surrounding `Result` style — don't introduce raw `throw`/`try` in
library code that already threads `Result`.

Schemas are **zod**; `@workflow/schema` is the only place that touches `z.toJSONSchema()` / `safeParse`.

## Architecture

Dependency direction: `schema` → `core` → `adapters` → `cli`, with `ui` and `examples` at the edges.
Packages are wired by **dependency injection** — `createRuntime()`, the CLI commands (`AppDeps`), and
the adapters all take their collaborators as arguments, which is what makes them testable with the
fakes above.

### `packages/core` — the execution engine

`createRuntime(deps)` returns the `Runtime` exposed to workflow scripts:
`agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `workflow()`, and `budget`. Each `agent()`
call walks a fixed sequence: increment seq → emit `agent-queued` → check abort → **journal lookup by
seq** (return cached result on hit — this is how resume works) → budget gate → agent-cap gate →
acquire **semaphore** slot → convert zod schema to JSON Schema → invoke `runner.run()` → validate
output → record to journal → emit events → release slot.

Key invariants when editing the runtime:

- **Determinism / sandbox** (`sandbox.ts`): scripts run in a Node `vm` context. `transformScript()`
  rewrites `export const meta = …` and wraps the body in an async IIFE; `extractMeta()` runs the
  script with sentinel-throwing stubs to read `meta` cheaply (used for the consent gate before a real
  run). `Date.now()`, `Math.random()`, and argless `new Date()` are **forbidden** inside the sandbox —
  they would break journal replay. Don't add nondeterministic globals.
- **Budget** is a *soft* gate, not a reservation — under concurrency a run can overshoot because
  several agents read `remaining()` before any records. `remaining()` is `Infinity` when no cap is set.
- **Nested workflows** are one level deep only: `workflow()` creates a child runtime that **shares the
  parent's budget** but whose own `workflow()` throws.
- **Events are the observable** (`events.ts`): the runtime emits a typed `WorkflowEvent` stream;
  `reduce(state, event)` rebuilds `RunState`, which is what the UI and registry consume. New runtime
  behavior should surface through events, not side channels.

`HarnessId` = `"claude" | "codex" | "copilot" | "raw-api"`.

### `packages/adapters` — harness backends

Each adapter implements `AgentRunner { id, capabilities, run(req, ctx) }` and maps the uniform
`AgentRequest` → a specific backend: `claude.ts` (CLI `--json-schema`), `codex.ts` (schema via temp
file, output read back from a file), `copilot.ts` (prompt + validation/retry loop), `raw-api.ts`
(Anthropic SDK directly — needs `ANTHROPIC_API_KEY`). `generic.ts` builds a config-driven adapter for
any CLI. Process spawning goes through the `ProcessRunner` abstraction (real or fake). Schema handling
differs per backend, so `coercion.ts` (`runWithSchemaRetry`) + `json.ts` (`extractJson`, AJV
validator) normalize/repair model output with retries. `detect.ts` probes `PATH` for available CLIs
and declares each adapter's `capabilities` (native schema, token reporting, tool events).

### `packages/cli` — `workflow` binary

Bin entry `workflow` → `dist/cli.js`. `dispatch(argv, deps)` is a pure router over `AppDeps`:

```
workflow run <script> [--args '{...}'] [--detach] [--yes]
workflow watch <id> | list | resume <id> | stop <id> | save <id> | adapters
workflow <name> [--args ...]      # run a saved workflow by name
```

A workflow's harness is **declared in `meta.harness`** and is the single source of truth — there is no
auto-detect and no CLI/config override of it. `adapter-select.ts` resolves that to an adapter
instance. Runs are persisted by `registry.ts` under `~/.workflow/runs/{runId}/` (events + journal as
JSONL) which is what powers `watch`, `resume`, and `save`. `consent.ts` gates execution: non-TTY/CI,
`--yes`, or a saved consent auto-allows; an interactive TTY prompts. Foreground runs render the Ink UI
with pause/stop/save controls; `--detach` spawns a headless child you tail via `watch`. Config is
layered from `~/.workflow/config.json` then `./.workflow/config.json` (`config.ts`).

### `packages/ui` — Ink TUI

React + **Ink** terminal dashboard. `startUi({ subscribe, … })` subscribes to the event stream; on a
TTY it renders a throttled (100ms) three-pane layout (phases / agents / detail) driven by `RunState`
+ pure `selectors.ts`, with `navReducer` handling arrow/vim navigation. Non-TTY falls back to
plain-text log lines (`line-log.ts`). UI interactions are emitted back through an `onAction` callback.

### `packages/examples`

Runnable example workflows (private). `src/haiku.workflow.ts` is the minimal single-`agent()` example;
run via `pnpm example` or `workflow run packages/examples/src/haiku.workflow.ts --yes`.

## Reference

- `docs/solutions/` — searchable knowledge store of past problems and learnings, one file per
  problem with YAML frontmatter (category/tags/problem_type). Read the relevant file **before**
  implementing or debugging in a documented area; add entries with the `compound` skill after solving
  something. `index.md` is auto-maintained — don't edit it by hand.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — design specs and implementation plans
  (orchestrator design, per-package plans, the VitePress docs-site design).
