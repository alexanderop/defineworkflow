---
title: "Bundled workflow scripts run in a vm sandbox: determinism guard, injected z/URL, zod-only schemas"
date: 2026-05-30
last_updated: 2026-05-31
track: knowledge
category: architecture-patterns
problem_type: "sandbox_execution_model"
module: "core"
component: "sandbox"
tags: ["sandbox", "vm", "workflow-scripts", "zod", "determinism", "bundled-workflows", "examples"]
applies_when: "authoring or loading workflow scripts (examples/*.ts, saved workflows) that the engine runs via the core sandbox"
---

# Bundled workflow scripts run in a vm sandbox with no imports, no zod, no Date.now/Math.random

## Context

`@workflow/core` executes workflow scripts (the `examples/*.ts` bundled workflows, plus saved
project/personal workflows) through `runInSandbox` in `packages/core/src/sandbox.ts`. The script
text is transformed with esbuild and run with `new vm.Script(...).runInContext(context)`. This is
**not** an ES module loader: there is no module resolution, and the only things a script can touch
are the globals injected into the vm context. (Local `./`/`../` imports in a _multi-file_ workflow
are inlined by an esbuild bundle step in the CLI **before** the sandbox sees the source — see
[[multi-file-workflows-esbuild-bundle]] — so the in-sandbox "no module loader" rule still holds.)

This shaped how Plan 4b's bundled workflows (`examples/deep-research.ts`,
`examples/vue-newsletter.ts`) had to be written, and why the opt-in e2e suite drives the engine a
particular way.

## Guidance

> **Updated 2026-05-31:** the "no zod" rule below was reversed. The CLI loader now **injects the
> engine's `z`** as a sandbox global (`packages/cli/src/loader.ts`), and `URL`/`URLSearchParams`
> are injected too (`packages/core/src/sandbox.ts`). Schema authoring is now **zod-only** — a plain
> JSON Schema reaching `agent({ schema })` fails with `SchemaValidation`. See the "What changed"
> note at the end. The determinism rules (`Date`/`Math`) are unchanged and still the core point.

A workflow script may use ONLY these injected globals (see the sandbox's globals object):
`agent`, `parallel`, `pipeline`, `workflow`, `phase`, `log`, `askUserQuestion`, `args`, `budget`,
`z`, plus a curated set of built-ins: `Promise`, `JSON`, `Array`, `Object`, `String`, `Number`,
`Boolean`, `Error`, `console`, `URL`, `URLSearchParams`. (`Set`, `Map`, `RegExp` resolve from the
realm and are usable.)

Hard rules for any script the sandbox will run:

- **No `import` / `require` resolution.** There is no module context; the `import … from
"defineworkflow"` line is _stripped_ and its names are bound to injected globals instead. Because
  `z` is injected, you **author schemas with zod** (`agent(prompt, { schema: z.object({ … }) })`) —
  the runtime converts zod → JSON Schema at the boundary. Importing `z` (or anything else) from a
  _foreign_ specifier such as `"zod"` is rejected: `transformScript` strips only the `defineworkflow`
  /`workflow` import, so a surviving `import … from "zod"` would be wrapped into the async IIFE body
  (an illegal static import) and esbuild fails with an opaque `Unexpected "{"`. `assertNoForeignImports`
  now catches this first and throws a `SandboxViolation` naming the module and pointing at
  `import { z } from "defineworkflow"`.
- **No `Date.now()`, no argless `new Date()`, no `Math.random()`.** The sandbox installs
  sentinel-throwing `Date`/`Math` (the determinism guard). Index slicing, string parsing, `Set`
  dedup, `new URL(u)`, etc. are all fine (all deterministic).
- Must `export default defineWorkflow({ … })` (or the legacy `export const meta = …`) as the first
  statement; top-level `await` and a trailing `return` are supported (the body is wrapped in an
  async IIFE).
- `args` is the parsed `--args` JSON (or `null`). Guard for missing fields.

Corollary for tests: a **schema-bearing agent CAN be expressed in a sandbox script** now — author
the schema with the injected `z` (e.g. `const Out = z.object({ n: z.number() })`). `loader.test.ts`
does exactly this. Driving the engine via `createRuntime` directly (e.g. the e2e in
`packages/cli/src/e2e.e2e.test.ts`) is still valid and the same real engine path, just without the
sandbox loader.

The `examples/` package intentionally ships **no `build`/`typecheck` scripts**: the scripts
reference undefined globals (`agent`, `parallel`, …) and would fail `tsc`. They are read as source
strings at runtime, and vitest's globs (`packages/*/src/**`) don't pick them up. Oxlint scans them
but only flags syntax/pattern rules, not undefined-variable errors, so they stay lint-clean.

## Why This Matters

Writing a bundled workflow that `import { z } from "zod"` or calls `Date.now()` looks correct and
type-checks in isolation, but throws `SandboxViolation` (or a module-not-found) the moment the
engine runs it — a failure that only surfaces at execution time, not at build/test time, because
the examples aren't compiled or unit-tested. Knowing the execution model up front avoids shipping a
workflow that can never run.

## When to Apply

- Adding or editing anything under `examples/` (bundled workflows).
- Writing saved workflows resolved by name (`.workflow/workflows/*`, `~/.workflow/workflows/*`).
- Writing tests that need a schema-bearing agent (use `createRuntime` directly, not a sandbox script).

## Examples

Verify a bundled workflow actually runs before assuming it's correct — load the source string and
run it through the built engine with a scripted runner (no model, no tokens):

```js
import { readFileSync } from "node:fs";
import { runWorkflow } from "<repo>/packages/cli/dist/index.js";
import { createJournal } from "<repo>/packages/core/dist/index.js";

const ok = (value) => ({ isOk: () => true, isErr: () => false, value }); // minimal neverthrow Ok
const source = readFileSync("<repo>/examples/deep-research.ts", "utf8");
const runner = {
  id: "s",
  capabilities: { nativeSchema: true, reportsTokens: true, toolEvents: false },
  async run(req) {
    let text = "a\nb";
    if (req.label?.startsWith("scope")) text = "x\ny";
    else if (req.label?.startsWith("verify")) text = "REAL";
    return ok({ text, data: undefined, usage: { inputTokens: 0, outputTokens: 1 }, toolCalls: [] });
  },
};
const r = await runWorkflow({
  source,
  args: { question: "q?" },
  runner,
  runId: "s",
  cwd: "/tmp",
  concurrency: 8,
  maxAgents: 1000,
  budgetTotal: null,
  journal: createJournal(),
  emit: () => {},
  now: () => 0,
});
console.log(r.isOk(), r.isOk() && r.value.returnValue); // true { question, confirmedCount, ... }
```

This catches `SandboxViolation` and module-not-found errors that the build/test pipeline cannot.

See also [[vitest-monorepo-build-and-filter-quirks]] for why the engine must be built before such a
script (or the e2e tests) can import the cross-package `dist`.
