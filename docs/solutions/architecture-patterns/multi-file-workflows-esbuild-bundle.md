---
title: "Multi-file workflows: esbuild-bundle local imports into one self-contained source before the vm sandbox"
date: 2026-05-31
track: knowledge
category: architecture-patterns
problem_type: "sandbox_execution_model"
module: "cli"
component: "bundle"
tags:
  [
    "multi-file-workflows",
    "esbuild",
    "bundle",
    "sandbox",
    "transformScript",
    "extractMeta",
    "defineWorkflow",
    "determinism",
    "registry",
    "knip",
  ]
applies_when: "adding multi-file workflow support, editing the workflow loader/sandbox, or splitting a workflow across a folder (entry + schemas + prompts)"
---

# Multi-file workflows: bundle local imports with esbuild before the vm sandbox

## Context

A workflow used to be a single TS file run in a `vm` sandbox that is **not** a module loader (see
[[workflow-sandbox-script-constraints]]): the loader strips only `import … from "defineworkflow"`
and injects the runtime primitives as globals, so any _other_ import survives into `vm.Script` and
fails. To let a workflow be split across a folder (a slim entry exporting `defineWorkflow({…})`
plus local `schemas.ts`/`prompts.ts` imported by relative path), we add **one esbuild bundle step
in the CLI** that inlines the entry's local imports into a single self-contained source string
_before_ anything else touches it. The bundle then flows through the unchanged pipeline: meta
extraction → consent → registry snapshot → sandbox.

The load-bearing insight: every runtime primitive (`agent`, `z`, `parallel`, …) is a sandbox
**global** and the journal is keyed by a single global call-order counter, so it does not matter
which _file_ an `agent()` call textually lives in. Pure-helper and sub-orchestrator helpers cost
the runtime the same; **almost all the work is in the bundle step**, not the runtime.

## Guidance

- **Bundle at read-time, store the bundle.** `packages/cli/src/commands/run.ts` reads the entry,
  calls `bundleWorkflow({ path, source })`, and threads the _bundle_ as `source` into `loadMeta`,
  consent, `clock.hash(source)`, and `registry.init(meta, source)`. Because the registry snapshot
  is the unit of replay, `save`/`resume`/`--detach` become self-contained **for free** — no extra
  code. Single-file workflows (no relative import) pass through unchanged (byte-identical).

- **`bundleWorkflow` (`packages/cli/src/bundle.ts`)** returns a neverthrow `Result<string,string>`:
  - Passthrough guard: if the source has no relative import (`/^\s*import\b[^'"]*from\s*["']\.\.?\//m`),
    return it unchanged — no esbuild work.
  - Otherwise esbuild `build({ stdin: { contents: source, resolveDir: dirname(path), sourcefile: path, loader: "ts" }, bundle: true, format: "esm", platform: "neutral", write: false, plugins: [localOnly] })`.
    Bundling **`source` via `stdin`** (not `entryPoints: [path]`) makes `source` the single source
    of truth and avoids a redundant second disk read; `resolveDir` lets relative imports resolve
    from the entry's directory.
  - **Local-only `onResolve` plugin** = determinism by construction: skip `entry-point`; mark
    `defineworkflow`/`workflow` `external: true`; let `./`,`../` resolve; **error on any other bare
    specifier** (`only import local files or "defineworkflow"`). No npm package can smuggle in
    `fs`/clocks/network.

- **esbuild's bundled default-export shape** (`packages/core/src/sandbox.ts`): esbuild turns
  `export default defineWorkflow({…})` into a hoisted `var <name> = defineWorkflow({…})` plus
  `export { <name> as default }` — and may append sibling named exports (`export { <name> as default, meta }`,
  either order). Two additive sandbox changes handle it:
  - `transformScript`: a branch that regex-captures the default-export local **anywhere** in the
    block — `/export\s*\{[^}]*?\b([A-Za-z0-9_$]+)\s+as\s+default\b[^}]*\}\s*;?/` — strips the whole
    `export {…}` statement, and appends `return await <name>.run({ agent, parallel, … })`. Capture
    the name (filename-derived), never hardcode. The loose `[^}]*` tolerates sibling exports —
    a narrow `\{\s*X\s+as\s+default\s*\}` silently misses `{ X as default, meta }` and diverges
    from the static path.
  - `extractMeta`/`locateMetaLiteral`: an **additive** fallback. Try the strict first-statement
    path (legacy `export const meta` / `__workflow`) first; only if it yields nothing, scan
    top-level declarations for a single `defineWorkflow(…)` call. This preserves every existing
    test (e.g. "rejects meta that is not the first statement", whose legacy `export const meta`
    source has no `defineWorkflow` call, so the fallback can't rescue it — it still throws).

- **Unlock:** because meta is read only from the entry's `defineWorkflow({…})` literal, helper
  files may now declare schemas at **top level** (`export const X = z.object({…})`) — they no
  longer have to live inside `run()`. `z` is a sandbox global at helper-init time.

- **knip:** folder-style examples need `workspaces["packages/examples"].entry: ["src/**/*.workflow.ts"]`
  (the old `src/*.workflow.ts` single-level glob misses `src/<name>/<name>.workflow.ts`, flagging
  the entry and its helpers as unused).

## Why This Matters

The sandbox is not a module loader, so "split across files" cannot be solved in the runtime — it
needs a bundling layer in front. Doing it at read-time (not lazily) is what makes the registry
snapshot self-contained, which is why resume/save/detach need zero new code. Getting the esbuild
default-export regex and the _additive_ meta fallback right is what keeps single-file workflows
and every existing test byte-identical while adding the new shape.

## When to Apply

- Adding or changing multi-file workflow support, or any edit to `bundle.ts`, `run.ts`'s load path,
  or `sandbox.ts`'s `transformScript`/`extractMeta`.
- Splitting a real workflow into a folder (see `packages/examples/src/deep-research/` —
  entry + `schemas.ts` + `prompts.ts` + `lib.ts` + `types.ts`, the 506→329-line conversion —
  and the minimal `packages/examples/src/multi-file-haiku/`).
- Debugging "must export const meta or defineWorkflow" on a bundled entry (regex didn't match the
  default-export shape) or a knip "unused file" on a nested example workflow.

## Examples

```ts
// schemas.ts — schemas now live at a helper's top level (was forced inside run())
import { z } from "defineworkflow";
export const SCOPE_SCHEMA = z.object({
  /* … */
});

// deep-research.workflow.ts — slim entry, reads like a table of contents
import { agent, defineWorkflow, pipeline } from "defineworkflow";
import { SCOPE_SCHEMA } from "./schemas.js"; // relative + .js extension
import { scopePrompt } from "./prompts.js";
export default defineWorkflow({
  name: "deep-research",
  harness: "claude" /* … */,
  async run() {
    const scope = await agent(scopePrompt(QUESTION), { schema: SCOPE_SCHEMA }); /* … */
  },
});
```

Known limitation: a **nested** `workflow("name")` target must be single-file or a saved
(already-bundled) workflow; a hand-placed multi-file nested workflow is not bundled by the nested
resolver (`packages/cli/src/resolve-workflow.ts`).
