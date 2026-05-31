---
title: "Enforcing immutability structurally with type-fest (Immutable/Tagged/JsonValue), not the linter"
date: 2026-05-31
track: knowledge
category: conventions
problem_type: "type_safety_convention"
module: "core"
component: "type-ext"
tags:
  [
    "type-fest",
    "immutability",
    "readonly",
    "tagged",
    "branded-types",
    "jsonvalue",
    "ingress",
    "oxlint",
    "typescript",
  ]
applies_when: "adding/typing core state, branded ids, or parsed ingress data; deciding how to enforce 'no mutations' in this repo"
---

# Enforcing immutability structurally with type-fest (Immutable/Tagged/JsonValue), not the linter

## Context

The goal was to "enforce no mutations / code more pure-functionally." Two findings shaped the
approach:

1. **oxlint cannot enforce data-mutation immutability.** oxlint 1.67.0 does **not** implement
   `eslint-plugin-functional`; rules like `functional/immutable-data` / `functional/no-let` are
   silently ignored (denying a real rule name produces byte-identical output to denying a made-up
   one). No lint rule here flags `obj.prop = x` or `arr.push()`.
2. The codebase was already ~98% type-level immutable, but immutability was maintained by
   hand-sprinkling `readonly` on every field — easy to forget on a _future_ field — and
   externally-sourced data (parsed JSON, CLI args) was typed as loose `unknown`.

So enforcement must live in the **type system**. `type-fest` (type-only, zero runtime weight)
provides the helpers; this doc captures how they're wired and the conventions for using them.

## Guidance

**One blessed vocabulary module, routed through `@workflow/core`.** `packages/core/src/type-ext.ts`
is the single home for the helpers, re-exported from `@workflow/core`. `type-fest` is a
**dependency of `@workflow/core` only** — every other package imports `Immutable`, `JsonValue`,
`Tagged`, `Simplify`, etc. from `@workflow/core`, never `type-fest` directly.

```ts
// packages/core/src/type-ext.ts — imports ONLY from type-fest (leaf re-export, no sibling imports)
import type {
  ReadonlyDeep,
  WritableDeep,
  Tagged,
  UnwrapTagged,
  JsonValue,
  JsonObject,
  Simplify,
  Merge,
} from "type-fest";
export type Immutable<T> = ReadonlyDeep<T>; // deeply immutable view — blessed for state & ingress
export type Mutable<T> = WritableDeep<T>; // deep inverse — only for build-then-freeze locals
export type { Tagged, UnwrapTagged, JsonValue, JsonObject, Simplify, Merge };
```

Three conventions follow:

- **New state/data types → mutable `…Shape` base + export `Immutable<Shape>`.** Don't hand-sprinkle
  `readonly` per field. The wrapper makes a forgotten modifier on a _new_ field structurally
  impossible — that _is_ the regression guard.

  ```ts
  interface AgentStateShape {
    key: string;
    tools: ToolEventShape[]; /* …no readonly… */
  }
  export type AgentState = Immutable<AgentStateShape>; // ⇒ deep readonly, ReadonlyArray, etc.
  ```

- **New nominal (branded) types → `Tagged<Base, "Name">`** (replaces a hand-rolled
  `Brand<T,B> = T & { readonly __brand: B }`). Mint with a single `as` cast at a trusted boundary.

  ```ts
  export type RunId = Tagged<string, "RunId">; // const id = "" as RunId
  export type AgentKey = Tagged<string, "AgentKey">;
  ```

- **Parsed / ingress data (JSON from disk, CLI `--args`) → `JsonValue`/`JsonObject`, exposed as
  `Immutable<…>`** so externally-sourced data is deeply frozen and precisely typed instead of
  loose `unknown`.

## Why This Matters

- **The compiler is the gate, not a linter that no-ops.** Relying on a silently-ignored lint rule
  is worse than nothing: it gives false confidence. The structural `Immutable<Shape>` wrapper can't
  be forgotten the way a per-field `readonly` can.
- **`Tagged<string, X>` survives `ReadonlyDeep` unchanged.** Verified against type-fest 4.41.0:
  `Tagged<string,X>` is `string & Tag<…>`, which is a subtype of `string`, so it matches
  `ReadonlyDeep`'s `T extends BuiltIns ? T` branch (`BuiltIns = Primitive | void | Date | RegExp`).
  Branded ids therefore pass through `Immutable<…>` intact — you can wrap a state type containing
  `RunId` without losing the brand.
- **The `consistent-type-assertions: "never"` oxlint rule (error level; only test files exempted)
  blocks an `as Mutable<T>` escape hatch**, so the immutability wrapper can't be trivially cast away.

## When to Apply

- Adding a new field to `RunState`/`AgentState`/`PhaseState`/`WorkflowEvent` or any central state →
  add it to the `…Shape` base (plain, no `readonly`); the export stays `Immutable<Shape>`.
- Adding a new id/hash type → `Tagged<string, "Name">` from `@workflow/core`.
- Reading JSON from disk or CLI argv → type the parse as `JsonValue`/`JsonObject` and return
  `Immutable<…>`.
- Needing a type-fest helper in any non-core package → import it from `@workflow/core`, and if it's
  not yet re-exported there, add it to `type-ext.ts` first (keep that file a leaf — imports only
  from `type-fest`, never sibling core modules, or you risk a build-order dependency cycle).

## Examples

**Ingress cast — branded fields force a double-cast; all-optional shapes don't:**

```ts
// registry.ts readMeta — RunMeta has runId: RunId (branded) + AdapterId/RunStatus unions,
// none assignable from raw JsonValue, so a double-cast is required (matches type-fest's own guidance):
const parsed: JsonValue = JSON.parse(raw);
// oxlint-disable-next-line typescript/consistent-type-assertions -- untyped JSON narrowed to persisted shape
return parsed as unknown as Immutable<RunMeta>;

// config.ts — WorkflowConfig is all-optional, so JsonObject is directly assignable (single cast ok):
const base = readJson(deps, personal) as WorkflowConfig; // returns Immutable<WorkflowConfig>
```

**Public-API change that is the whole point:** the authoring `args` global became
`Immutable<JsonValue>` (was `unknown`). Authors who _narrow_ still compile
(`const a = args as { feature?: string }`); authors who _mutate_ `args` now get a compile error.

**Reducer is untouched, type-only.** Wrapping `RunState` as `Immutable<RunStateShape>` turns its
`Map` fields into `ReadonlyMap<K, Immutable<V>>`, but `reduce()`'s `new Map(state.agents)` copies,
`.set(...)` calls, and `[...a.tools, event.tool]` spreads all still type-check (a `Map` is assignable
to a `ReadonlyMap` slot; a fresh mutable literal is assignable into an `Immutable<…>` slot). No `any`,
no behavior change. Drive such a retrofit with `pnpm typecheck`; the existing reducer tests
(`events.test.ts`) are the behavioral safety net.

**Verification was compiler-only** (`pnpm build` → `pnpm typecheck` → `pnpm test` → `pnpm lint` →
`pnpm knip`). knip does **not** flag `type-fest` as unused even though it's used only in
`import type` positions — knip detects type-only imports.
