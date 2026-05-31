---
title: "Typed pipeline() overloads, zod-only schemas, and shipping URL types to a types:[] package"
date: 2026-05-31
track: knowledge
category: developer-experience
problem_type: "type_authoring_and_testing"
module: "core"
component: "runtime/sandbox/workflow"
tags: ["typescript", "overloads", "pipeline", "zod", "expecttypeof", "declare-global", "node-url", "exactoptionalpropertytypes", "authoring-api"]
applies_when: "adding typed variadic-ish APIs to the Runtime, narrowing the agent schema surface, type-level tests, or shipping ambient host-global types to the examples (types:[]) package"
---

# Typed pipeline() overloads, zod-only schemas, and shipping URL types to a types:[] package

## Context

Three engine-side authoring changes landed together (typed `pipeline()`, zod-only `agent({ schema })`,
`URL` in the sandbox). Each had a non-obvious TypeScript or ripple gotcha worth recording so the next
similar change is quick.

## Guidance

### 1. Typed `pipeline()` = fixed-arity overloads on the `Runtime` interface, loose impl signature

`pipeline(items, ...stages)` is variadic with each stage's `prev` typed from the *prior* stage's
return — a true recursive-tuple type is fragile. Instead declare **fixed-arity overloads for 1–5
stages** plus a final loose variadic fallback, all on the `Runtime` interface
(`packages/core/src/runtime.ts`):

```ts
pipeline<T, A>(items: readonly T[], s1: (prev: T, item: T, index: number) => Promise<A>): Promise<Array<A | null>>;
pipeline<T, A, B>(items: readonly T[], s1: (prev: T, …) => Promise<A>, s2: (prev: A, …) => Promise<B>): Promise<Array<B | null>>;
// …<T,A,B,C>, <T,A,B,C,D>, <T,A,B,C,D,E> …
pipeline(items: readonly unknown[], ...stages: ReadonlyArray<(prev: unknown, item: unknown, index: number) => Promise<unknown>>): Promise<Array<unknown | null>>;
```

- The runtime **implementation signature stays the loose variadic** — overloads are type-only; the
  impl is unchanged.
- `packages/workflow/src/index.ts` re-exports via `export const pipeline: Runtime["pipeline"]`, so the
  overloads propagate to authors automatically (one source of truth). Assigning `runtimeOnly`
  (`() => never`) to that overloaded type stays valid (`() => never` is assignable to any fn type).
- 6+ stages fall back to the untyped variadic — acceptable; no workflow exceeds 3 stages.

### 2. `expectTypeOf(...).toEqualTypeOf` + boolean literal narrowing = a false "Actual: never"

Type-level test gotcha that cost real debugging time. A pipeline stage written as:

```ts
async (prev) => (prev ? { ok: prev } : null)   // prev: boolean
```

infers `{ ok: true } | null` — **not** `{ ok: boolean } | null` — because in the truthy branch `prev`
narrows to the literal `true`. `expectTypeOf(out).toEqualTypeOf<Array<{ ok: boolean } | null>>()` then
fails with a cryptic `Type '…' does not satisfy the constraint '("Expected: …, Actual: never" | …)[]'`.
The overload is fine; the *test* is wrong. Fix: pin the stage's return with an explicit annotation so
the literal doesn't leak, and assert the boundary type directly:

```ts
async (prev): Promise<{ ok: boolean } | null> => {
  expectTypeOf(prev).toBeBoolean();
  return prev ? { ok: prev } : null;
},
```

`toEqualTypeOf` is exact/invariant (stricter than assignability), so `{ ok: true }` ≠ `{ ok: boolean }`.
When a `toEqualTypeOf` error reads "Actual: never", suspect literal narrowing or an `any`/`never` leak,
not a real inference failure — probe by Reading the actual type (assign it to a wrong type to force a
hover error) before "fixing" the overload.

### 3. Shipping `URL` types to a `types: []` package without polluting it

`packages/examples` compiles with `"types": []` (so the editor shows *exactly* the sandbox surface, no
`process`/`fs`/`document`). To type the injected `URL`/`URLSearchParams` globals, ship an ambient
declaration from `defineworkflow` (`packages/workflow/src/index.ts`):

```ts
declare global {
  // oxlint-disable no-var
  var URL: typeof import("node:url").URL;
  var URLSearchParams: typeof import("node:url").URLSearchParams;
  // oxlint-enable no-var
}
```

Two empirically-verified facts (test them; don't assume):
- **No conflict in the `workflow` package's own typecheck** even though it has `@types/node`: two
  ambient `var` declarations of the *same* type merge. (`const`/`interface` would clash — use `var`.)
- **`typeof import("node:url").URL` resolves under `types: []`** — `new URL().hostname/.pathname/
  .searchParams.get()` all type — so the *preferred* approach works; the hand-written-interface
  fallback isn't needed. The tsup `.d.ts` rollup keeps the `import("node:url")` reference (it only
  inlines `@workflow/*`), and consumers resolve it fine.
- Don't reach for `lib:["DOM"]`/`types:["node"]` — they'd expose globals the sandbox does NOT provide,
  making the editor lie about the runtime surface. `oxlint`'s global `no-var` rule needs the inline
  disable.

### 4. Narrowing `agent({ schema })` to zod-only ripples into every sandbox-script test fixture

`AgentOptions.schema: JsonSchema | ZodLike` → `ZodLike`, and the runtime now rejects a non-zod schema
with `SchemaValidation` (a plain object is only reachable from type-erased sandbox JS). Consequences:
- The CLI **loader injects `z`** into the sandbox, so test fixtures that build a schema inside a
  workflow-script string must author it with zod (`const Out = z.object({ … })`), not a plain
  `{ type: "object", … }`. Fixtures in `loader.test.ts`, `execute.test.ts`, `e2e.e2e.test.ts` and the
  two core `runtime.test.ts` schema tests all needed converting — a passing `pnpm build/typecheck`
  won't catch the *runtime* failures; `pnpm test` does.
- **`AgentRequest.schema` stays `JsonSchema`** — adapters consume JSON Schema unchanged, so the
  adapter tests (`claude/codex/copilot/generic/raw-api/json.test.ts`) that pass a plain JSON Schema as
  the *request* schema are correct and must NOT be converted.
- `JsonSchema`/`ZodLike` stay exported from `@workflow/core` (internal use); knip stays green.

## Why This Matters

Each gotcha looks like a deep type-system or engine bug at first glance (a "never" type, a global
redeclaration error, a green build with red tests) but is actually a known, cheap pattern. Recording
them turns a multi-hour investigation into a lookup.

## When to Apply

- Adding any typed variadic-ish primitive to `Runtime` (mirror the overload pattern, keep the impl loose).
- Writing `expectTypeOf` type-level tests where a stage/callback return involves a ternary on a
  primitive (annotate the return).
- Exposing a host global to the `types: []` examples package (ambient `var` + `typeof import("node:…")`).
- Narrowing any authoring-surface union — search for sandbox-script and runtime test fixtures, not just
  the type, and re-run `pnpm test` (not only typecheck).

## Examples

Verify the URL-type mechanism in isolation before committing (this is the actual check that was run):

```bash
# Under types:[] (examples context): new URL(...).hostname etc. must resolve via the ambient decl.
cd packages/examples && tsc --noEmit   # 0 errors with the declare-global shipped from defineworkflow
```

See also [[workflow-sandbox-script-constraints]] (the injected-globals list and determinism guard) and
[[knip-false-positives-in-this-monorepo]] (why removing the examples' `JsonSchema` import stays clean).
</content>
