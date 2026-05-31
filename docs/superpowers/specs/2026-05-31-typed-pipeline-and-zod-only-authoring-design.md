# Typed `pipeline()` + zod-only authoring + `URL` in the sandbox

**Date:** 2026-05-31
**Status:** Design approved, awaiting spec review

## Motivation

Porting the `deep-research` workflow into `packages/examples` surfaced three rough edges in the
authoring API. They are not example problems — they have root causes in the engine:

1. **`pipeline()` is untyped.** Its signature is `pipeline(items: readonly unknown[], ...stages:
((prev: unknown, item: unknown, index: number) => Promise<unknown>)[]): Promise<Array<unknown |
null>>`. Every stage receives `unknown`, so each workflow casts `prev as SomeType` (with an
   `oxlint-disable consistent-type-assertions` comment) at the top of every stage and again on the
   final result. `parallel<T>` is already generic; `pipeline` is the only primitive that loses types.
2. **`agent({ schema })` accepts both zod and plain JSON Schema.** A plain JSON Schema makes
   `agent()` return `unknown`, forcing yet more casts, and gives two ways to do the same thing. The
   authoring story should be one way: zod.
3. **`new URL()` throws in the sandbox.** `URL` is a Node host global, not an ECMAScript intrinsic,
   and `sandbox.ts` only injects intrinsics + the runtime primitives. Authors must hand-roll regex URL
   parsing instead of the obvious `new URL(u)`.

Goal: make a faithful port of the `deep-research` harness read cleanly — `await` everywhere (no
`.then`), zero `as` casts in workflow bodies, and `new URL()` available — by fixing the causes, not
papering over them in the example.

## Decisions (locked during brainstorming)

- **Schema authoring is zod-only.** Users author with zod; the runtime converts zod → JSON Schema at
  the boundary before any adapter/harness sees it. JSON Schema remains the _internal/harness_ schema
  format.
- **Blast radius: engine + both examples.** Make the engine changes and update every example
  (`deep-research`, `vue-newsletter`, `feature-pipeline`) so the repo is consistent — no stale casts
  left behind.
- **Typed pipeline via fixed-arity overloads**, not a recursive variadic tuple type.
- **`URL` type delivered via an ambient `declare global` shipped by the `defineworkflow` package**, so
  the examples keep `types: []` (the editor sees exactly the sandbox surface, nothing more).

## Architecture / changes

Dependency direction is unchanged: `schema → core → adapters → cli`, with `workflow`/`examples` at the
edges. All four changes are independent and could land as separate commits.

### 1. Generic `pipeline()` (typed)

**Where:** the `Runtime` interface in `packages/core/src/runtime.ts` (currently the single signature
at ~line 93). `packages/workflow/src/index.ts` re-exports it via `export const pipeline:
Runtime["pipeline"]`, so the overloads propagate automatically — one source of truth.

Replace the single signature with fixed-arity overloads for **1–5 stages**, plus a loose variadic
fallback (identical to today's signature) for 6+ stages or non-inferable cases. Stage 1's `prev` is the
item itself (the runtime does `let prev = item`), and `item`/`index` are threaded to every stage:

```ts
pipeline<T, A>(
  items: readonly T[],
  s1: (prev: T, item: T, index: number) => Promise<A>,
): Promise<Array<A | null>>;
pipeline<T, A, B>(
  items: readonly T[],
  s1: (prev: T, item: T, index: number) => Promise<A>,
  s2: (prev: A, item: T, index: number) => Promise<B>,
): Promise<Array<B | null>>;
// …<T, A, B, C>, <T, A, B, C, D>, <T, A, B, C, D, E> …
pipeline(
  items: readonly unknown[],
  ...stages: ReadonlyArray<(prev: unknown, item: unknown, index: number) => Promise<unknown>>
): Promise<Array<unknown | null>>;
```

- The **runtime implementation signature** stays the loose variadic (line ~347) — overloads are a
  type-only concern; the implementation is unchanged.
- The `| null` on the result reflects the existing behavior: a throwing stage drops that item to
  `null`. A stage that itself returns `X | null` (e.g. returns `null` on a skip) flows that union into
  the next stage's `prev` — the next stage must handle it, exactly as today but now type-checked.
- Assigning `runtimeOnly` (`() => never`) to the overloaded `Runtime["pipeline"]` type in
  `workflow/index.ts` stays valid (`() => never` is assignable to any function type).

### 2. zod-only authoring for `agent({ schema })`

**Where:** `packages/core/src/runtime.ts` (`AgentOptions`, the agent schema-normalization block ~line
219–227) and `packages/workflow/src/index.ts` (the `agent` overloads).

- `AgentOptions.schema?: JsonSchema | ZodLike` → **`AgentOptions.schema?: ZodLike`**.
- `workflow/index.ts` `agent` overloads keep exactly two shapes per call form:
  - `agent<T>(prompt, opts: AgentOptions & { schema: z.ZodType<T> }): Promise<T>`
  - `agent(prompt, opts?: AgentOptions): Promise<unknown>` (no schema → raw text)
  - (plus the `profile`-leading variants)
    There is no longer a call shape where a schema yields `unknown`.
- **Runtime requires zod and converts it.** The normalization becomes "if zod → `toJsonSchema()`;
  otherwise fail fast with a clear `SchemaValidation` error" (a non-zod schema is only reachable from
  type-erased sandbox JS). The previous silent `toJsonSchemaObject(rawSchema)` acceptance of raw JSON
  Schema is removed.
- **`AgentRequest.schema` stays `JsonSchema`** — adapters consume JSON Schema unchanged. The
  `JsonSchema` type stays exported from `@workflow/core` (and re-exported by `workflow`) for internal
  use; examples simply stop importing it.
- **Docs:** update `CLAUDE.md` and the `building-workflows` skill, both of which currently say
  `agent({ schema })` "accepts either a plain JSON Schema object or a zod schema."

### 3. `URL` in the sandbox

**Where:** `packages/core/src/sandbox.ts` (the `sandbox` globals object ~line 299) and the
`defineworkflow` package types.

- Add `URL` and `URLSearchParams` to the injected sandbox globals. Both are deterministic and safe —
  no clocks, no randomness — so they don't violate the replay invariant.
- **Type delivery:** ship an ambient `declare global` from the `defineworkflow` package declaring just
  these host globals, so a workflow file (which imports from `defineworkflow`) sees `URL`/
  `URLSearchParams` typed while `packages/examples/tsconfig.json` keeps `"types": []`. Mechanism to be
  finalized in the plan — preferred `const URL: typeof import("node:url").URL` (pulls the real type
  without polluting the author scope with all of `@types/node`); fall back to a minimal hand-written
  interface if `node:url` type resolution under `types: []` proves unreliable.
- Rationale for not relaxing the tsconfig: adding `lib: ["DOM"]` or `types: ["node"]` would expose
  `document`/`window`/`process`/`fs` — globals the sandbox does **not** provide — making the editor lie
  about the runtime surface.

### 4. Example rewrites

- **`packages/examples/src/deep-research.workflow.ts`** — async/await thunks throughout (no
  `.then`/`.catch`; the fetch error path becomes `try/catch`); generic pipeline removes all three `as`
  casts; `new URL()` in `normURL`/`hostOf`; `.js`-matching names (`SCOPE_SCHEMA`, `SEARCH_SCHEMA`,
  `EXTRACT_SCHEMA`, `VERDICT_SCHEMA`, `REPORT_SCHEMA` as zod consts; `SEARCH_PROMPT`, `FETCH_PROMPT`,
  `VERIFY_PROMPT`; state `relRank`/`seen`/`dupes`/`budgetDropped`/`fetchSlots`). The defensive
  null-handling (user-skip → drop; verify abstentions) is preserved.
- **`packages/examples/src/vue-newsletter.workflow.ts`** — convert `ITEM`/`SOURCE_RESULT`/`CURATED`
  from plain JSON Schema to zod; drop the `import type { JsonSchema }` and the `as SourceResult` /
  `as Curated` casts (zod types them).
- **`packages/examples/src/feature-pipeline.workflow.ts`** — remove the 3 `as` casts in the pipeline
  stages and their `oxlint-disable consistent-type-assertions` comments, now that stages are typed.
- The `args` narrowing cast (ingress `Immutable<JsonValue>` → the run's expected shape) **stays** in all
  three — that is the documented convention and is unaffected.

## Testing

- **Type-level tests** following the existing `_typecheck()` pattern in
  `packages/workflow/src/index.test.ts`:
  - a 2- and 3-stage `pipeline` infers each stage's `prev` from the prior stage's return and the final
    result is `Array<Last | null>`;
  - `agent({ schema: <plain object> })` is a **type error**; `agent({ schema: z.object(...) })` yields
    the inferred type; `agent(prompt)` (no schema) yields `unknown`.
- **Runtime tests** (`packages/core/src/runtime*.test.ts`):
  - `pipeline` runs stages in order, threads `item`/`index`, and drops a throwing stage's item to
    `null` (extend existing coverage);
  - a zod schema is converted to JSON Schema in the emitted `AgentRequest`;
  - a non-zod schema object reaching `agent()` fails with `SchemaValidation`.
- **Sandbox test** (`packages/core/src/sandbox.test.ts`): a workflow script that calls `new URL(...)`
  executes without a "URL is not defined" `ReferenceError`.
- **mock-runner**: the `minItems` test added this session (arrays satisfy `minItems`) stays.
- **Gates:** `pnpm build → pnpm typecheck → pnpm lint → pnpm test → pnpm knip`, plus `--mock` runs of
  `deep-research` and `vue-newsletter` to confirm they are cast-free _and_ still execute end-to-end.

## Risks / notes

- **Overload arity cap (5).** Pipelines with 6+ stages fall back to the untyped variadic — no
  regression, just no inference. No current workflow exceeds 3 stages. If one ever does, add an
  overload.
- **`node:url` type resolution under `types: []`.** If `typeof import("node:url").URL` doesn't resolve
  in the examples typecheck context, fall back to a minimal hand-written `URL`/`URLSearchParams`
  ambient interface (only the members workflows use: `hostname`, `pathname`, `searchParams`, etc.).
- **knip.** Removing `JsonSchema` imports from examples and the second silent schema path may trip knip
  (unused export / dep). Re-run knip and consult
  `docs/solutions/developer-experience/knip-false-positives-in-this-monorepo.md` before acting.
- **Pre-existing failures.** `packages/cli/src/orchestrator.test.ts` has 2 failures already present in
  the working tree (unrelated to this work); they are out of scope and should not be attributed to
  these changes.
- **No `defineworkflow` major bump implied here** — these are additive (pipeline overloads, URL) and a
  type-narrowing (zod-only). The narrowing is technically breaking for any external author passing
  plain JSON Schema; call it out in the changeset/release notes when this ships.

## Out of scope

- Recursive variadic typing for unbounded pipeline stages.
- Any change to `parallel` (already generic), `workflow()`, or `askUserQuestion`.
- Adding further host globals to the sandbox beyond `URL`/`URLSearchParams`.
