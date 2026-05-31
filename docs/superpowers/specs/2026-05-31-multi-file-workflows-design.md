# Multi-file workflows — design

**Date:** 2026-05-31
**Status:** Approved (brainstorm), pending implementation plan

## Problem

Today a workflow is a single `*.workflow.ts` file. Everything — meta, every zod schema,
every prompt string, every helper — is crammed into one file, and schemas must be declared
*inside* `run()` because of the "`defineWorkflow` must be the first runtime statement" rule
(see `vue-todo-pipeline.workflow.ts`, where ~50 lines of schemas open `run()` before any
orchestration). The orchestration logic — the part a reader cares about — is buried.

We want a user to be able to split a workflow across a folder: schemas in one file, prompts
and helpers in others, and a slim entry file whose `run()` reads like a table of contents.

## Constraints discovered in the codebase

- A workflow is loaded as **one source string** and executed in a Node `vm` sandbox
  (`packages/core/src/sandbox.ts`). The runtime primitives (`agent`, `parallel`, `z`,
  `phase`, `log`, …) are injected as **sandbox globals** (`sandbox.ts:299-317`).
- The loader strips only `import … from "defineworkflow"` / `"workflow"` lines
  (`stripWorkflowImports`, `sandbox.ts:65`). **Any other import survives into the
  `vm.Script` and fails** — there is no module loader inside the sandbox.
- `extractMeta` (`sandbox.ts:114`) reads `meta` **statically** for the consent gate, and
  requires `defineWorkflow(...)` to be the **first runtime statement** so it never executes
  the body.
- The journal is keyed by a single **global sequence counter** that increments in `agent()`
  call order. Determinism is enforced at runtime by banning `Date.now()` / `Math.random()` /
  argless `new Date()` as sandbox globals.

### Key insight

Because every primitive is a **global** and the journal is keyed by global call-order, it
does not matter which *file* an `agent()` call textually lives in. A helper module that calls
`agent()` is just calling the same global in deterministic order. So pure helpers (schemas,
prompt builders) and sub-orchestrator helpers (that call `agent()` themselves) cost the
runtime **exactly the same** — journal, resume, and the determinism guards keep working
untouched. **Almost all the work is in one new place: a bundle step before the sandbox.**

## Decisions

1. **Authoring shape — entry file + relative imports.** A workflow is a folder organized
   however the author likes. One **entry file** holds `defineWorkflow` and a slim `run()`;
   everything else is normal TS imported with relative (`./`, `../`) paths.
2. **Import scope — local files only.** Helpers may import other files within the workflow's
   own project (relative paths) plus `defineworkflow`. **No npm packages.** This keeps the
   bundle self-contained and the sandbox deterministic *by construction* — nothing can pull
   in `fs`, clocks, or network. Enforced at bundle time (clear error), not left to chance.
3. **Meta stays in the entry file** as a pure literal in the `defineWorkflow({...})` call —
   same rule as today. The consent gate reads it from the entry file alone.
4. **`workflow save` persists the *bundled* string**, so a saved/named workflow stays a
   portable, self-contained unit in the registry.

## Design

### Authoring example

```
vue-todo/
  vue-todo.workflow.ts     # entry: meta + a readable run()
  schemas.ts               # all the zod schemas
  prompts/
    research.ts
    plan.ts
    tdd.ts
  lib/sandbox-rule.ts
```

```ts
// schemas.ts
import { z } from "defineworkflow";
export const ResearchSchema = z.object({ /* … */ });
export const PlanSchema = z.object({ /* … */ });
```

```ts
// vue-todo.workflow.ts
import { agent, phase, defineWorkflow } from "defineworkflow";
import { ResearchSchema, PlanSchema } from "./schemas";
import { researchPrompt, planPrompt } from "./prompts/research";

export default defineWorkflow({
  name: "vue-todo", harness: "claude", /* …meta… */
  async run() {
    phase("Research");
    const research = await agent(researchPrompt(feature), { schema: ResearchSchema });
    // …reads like a table of contents…
  },
});
```

Run it as today: `workflow run vue-todo/vue-todo.workflow.ts`, plus optional folder sugar
(`workflow run vue-todo/` resolves a conventional entry filename).

### Execution flow

1. **New bundle step before the sandbox.** Use esbuild (already a dependency) to bundle the
   entry + its local imports into one string, marking `defineworkflow` / `workflow`
   **external**. An esbuild `onResolve` hook **rejects any non-relative specifier**, which is
   what enforces "local only" with a clear error instead of silently resolving from
   `node_modules`. A workflow with no local imports skips bundling entirely (fast path =
   today's behavior).
2. **The bundled string feeds the existing sandbox unchanged.** The externalized
   `defineworkflow` import is stripped and the runtime injected exactly as today. Journal,
   seq counter, resume, budget, and the determinism bans are untouched — the bundle runs in
   the same sandbox with the same globals.
3. **`extractMeta` reads the entry file alone** (imports stripped) so the consent gate never
   needs to bundle.

### Bonus unlocked by the bundle

The awkward "schemas must be declared *inside* `run()`" rule disappears for helper-defined
schemas. Because `extractMeta` only inspects the *entry* file, a `schemas.ts` can declare
top-level `export const ResearchSchema = z.object({…})` — `z` is a sandbox global at run
time, so helper-module init (which runs inside the sandbox) just works. This is exactly the
"all the schema in one file" the user asked for.

### Implementation risk to spike first

esbuild's output shape for `export default defineWorkflow(...)` must line up with
`transformScript`'s rewrite (`sandbox.ts:46-52`, which regex-matches
`export default defineWorkflow(`). esbuild may hoist this to
`var workflow_default = defineWorkflow(...); export { workflow_default as default }`, which
the current regex would miss.

- **Primary path:** spike esbuild's actual output; if `transformScript` can be made
  bundle-tolerant cheaply, keep the existing IIFE + global-injection sandbox.
- **Fallback path:** bundle as **CJS + a `require` shim** in the sandbox (the shim returns
  the injected primitives for `"defineworkflow"`; read the workflow back off
  `module.exports.default`). Shape-robust, slightly larger sandbox refactor. Determinism bans
  still apply (Date/Math remain global references esbuild does not rewrite).

The plan resolves this fork by spiking esbuild output before committing to a path.

## What does NOT change

- The runtime engine, journal/replay, determinism bans, UI, and adapters.
- Every existing single-file workflow: no local imports → no bundling → identical path.
- `meta` being a pure literal in the entry's `defineWorkflow({...})` call.

## Out of scope (YAGNI)

- npm / `node_modules` imports in workflows (decision #2: local files only).
- A manifest/config file describing the folder layout — relative imports are the manifest.
- Helper-level meta or multiple `defineWorkflow` exports per workflow.
