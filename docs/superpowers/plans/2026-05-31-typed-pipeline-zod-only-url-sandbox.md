# Typed `pipeline()` + zod-only authoring + `URL` in the sandbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use references/subagent-driven-development/SKILL.md (recommended) or references/executing-plans/SKILL.md to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove three authoring rough edges at their engine root: make `pipeline()` infer stage types, make `agent({ schema })` zod-only, and inject `URL`/`URLSearchParams` into the sandbox — then rewrite all three examples to be cast-free.

**Architecture:** Four independent changes along the unchanged dependency direction `schema → core → adapters → cli`, with `workflow`/`examples` at the edges. Pipeline overloads live on the `Runtime` interface (re-exported by `workflow`); the zod-only narrowing lives in `runtime.ts` + the `workflow` `agent` overloads; `URL` is injected in `sandbox.ts` and typed via an ambient `declare global` shipped from `defineworkflow`.

**Tech Stack:** TypeScript (strict, `Bundler` resolution, `lib: ES2023`), zod v4, vitest, tsup, oxlint, knip, pnpm workspaces.

---

## Recalled learnings (Step 1)

- **`workflow-sandbox-script-constraints.md`**: workflow scripts run in a `vm` context and may use ONLY injected globals + a curated builtin set. Adding `URL`/`URLSearchParams` to that globals object is exactly the supported extension mechanism. Determinism guard (`Date`/`Math`) must stay — `URL`/`URLSearchParams` are pure and safe.
- **`knip-false-positives-in-this-monorepo.md`**: `JsonSchema`/`ZodLike` exports and `packages/workflow` bundled deps are known knip edge cases. Removing the `JsonSchema` import from examples is fine (examples are entry-globbed). Keep `JsonSchema` exported from `@workflow/core`/`workflow` (still used internally). If knip flags `ZodLike` as internal-only, dropping the `export` keyword (not deleting) is the fix — but it is part of the public `AgentOptions.schema` surface here, so keep it exported.

## Verified pre-work facts

- `lib: ["ES2023"]` (no DOM): `URL` is NOT in the lib; it comes only from `@types/node`.
- **Empirically tested** (`/tmp/urltest`): `declare global { var URL: typeof import("node:url").URL }`
  - does NOT conflict with `@types/node`'s global `URL` (two `var` of identical type merge) — `workflow` typecheck stays green;
  - DOES resolve `new URL().hostname/.pathname/.searchParams.get()` under `types: []` (the examples context).
  - → Use the **preferred** `typeof import("node:url").URL` approach; no hand-written fallback needed.
- `packages/examples` has a `tsconfig.json` (`types: []`) but **no `typecheck` script**, so `pnpm -r typecheck` skips it. Examples are verified via `--mock` runs, not tsc. `packages/workflow` IS typechecked (and is where the type-level tests live).
- Runtime `agent()` schema block is `runtime.ts:219–235`; `toJsonSchemaObject` helper is `runtime.ts:116–118`. Pipeline impl is `runtime.ts:341–355`. `Runtime` interface `pipeline` signature is `runtime.ts:93`.

---

## Task 1: Typed `pipeline()` overloads on the `Runtime` interface

**Files:**
- Modify: `packages/core/src/runtime.ts:93` (the `Runtime.pipeline` signature)
- Modify: `packages/workflow/src/index.test.ts` (add type-level pipeline tests)
- Modify: `packages/core/src/runtime.pipeline.test.ts` (extend runtime coverage — item/index threading)

- [ ] **Step 1: Add type-level pipeline tests (failing at typecheck)**

In `packages/workflow/src/index.test.ts`, add a new `describe("pipeline typing", …)` block. `pipeline` is re-exported from `./index.js` so import it there:

```ts
import { agent, pipeline, z } from "./index.js";
```

```ts
describe("pipeline typing", () => {
  it("infers each stage's prev from the prior stage's return (2 stages)", () => {
    async function _typecheck(): Promise<void> {
      const out = await pipeline(
        [1, 2, 3],
        async (prev, item, index) => {
          expectTypeOf(prev).toBeNumber();
          expectTypeOf(item).toBeNumber();
          expectTypeOf(index).toBeNumber();
          return `s1:${prev}`;
        },
        async (prev) => {
          expectTypeOf(prev).toBeString();
          return prev.length;
        },
      );
      expectTypeOf(out).toEqualTypeOf<Array<number | null>>();
    }
    expect(typeof _typecheck).toBe("function");
  });

  it("threads the item type through 3 stages and yields Array<Last | null>", () => {
    async function _typecheck(): Promise<void> {
      const out = await pipeline(
        ["a", "b"],
        async (prev) => prev.length,
        async (prev) => prev > 0,
        async (prev) => (prev ? { ok: prev } : null),
      );
      expectTypeOf(out).toEqualTypeOf<Array<{ ok: boolean } | null>>();
    }
    expect(typeof _typecheck).toBe("function");
  });
});
```

- [ ] **Step 2: Verify it fails at typecheck**

Run: `pnpm --filter defineworkflow exec tsc --noEmit` (after `pnpm build`)
Expected: errors — `prev`/`item` are `unknown`, and the result is `Array<unknown | null>` not the inferred type.

- [ ] **Step 3: Replace the single `Runtime.pipeline` signature with fixed-arity overloads (1–5) + variadic fallback**

In `packages/core/src/runtime.ts`, replace line 93:

```ts
  pipeline(items: readonly unknown[], ...stages: ReadonlyArray<(prev: unknown, item: unknown, index: number) => Promise<unknown>>): Promise<Array<unknown | null>>;
```

with:

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
  pipeline<T, A, B, C>(
    items: readonly T[],
    s1: (prev: T, item: T, index: number) => Promise<A>,
    s2: (prev: A, item: T, index: number) => Promise<B>,
    s3: (prev: B, item: T, index: number) => Promise<C>,
  ): Promise<Array<C | null>>;
  pipeline<T, A, B, C, D>(
    items: readonly T[],
    s1: (prev: T, item: T, index: number) => Promise<A>,
    s2: (prev: A, item: T, index: number) => Promise<B>,
    s3: (prev: B, item: T, index: number) => Promise<C>,
    s4: (prev: C, item: T, index: number) => Promise<D>,
  ): Promise<Array<D | null>>;
  pipeline<T, A, B, C, D, E>(
    items: readonly T[],
    s1: (prev: T, item: T, index: number) => Promise<A>,
    s2: (prev: A, item: T, index: number) => Promise<B>,
    s3: (prev: B, item: T, index: number) => Promise<C>,
    s4: (prev: C, item: T, index: number) => Promise<D>,
    s5: (prev: D, item: T, index: number) => Promise<E>,
  ): Promise<Array<E | null>>;
  pipeline(
    items: readonly unknown[],
    ...stages: ReadonlyArray<(prev: unknown, item: unknown, index: number) => Promise<unknown>>
  ): Promise<Array<unknown | null>>;
```

Leave the runtime *implementation* signature (line ~341) UNCHANGED (the loose variadic). Overloads are a type-only concern.

- [ ] **Step 4: Verify type-level tests now typecheck**

Run: `pnpm build && pnpm --filter defineworkflow exec tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 5: Extend runtime.pipeline.test.ts to assert item/index threading**

Add to `packages/core/src/runtime.pipeline.test.ts` (inside the existing `describe("pipeline", …)`):

```ts
it("threads item and index to every stage and runs stages in order", async () => {
  const seen: Array<{ stage: number; prev: unknown; item: unknown; index: number }> = [];
  const r = createRuntime({
    runner: createScriptedRunner({}),
    semaphore: createSemaphore(8),
    journal: createJournal(),
    maxAgents: 1000,
    budgetTotal: null,
    args: {},
    cwd: "/tmp",
    runId: "r" as RunId,
    emit: () => {},
    now: () => 0,
  });
  const out = await r.pipeline(
    ["x", "y"],
    async (prev, item, index) => {
      seen.push({ stage: 1, prev, item, index });
      return `${item}-1`;
    },
    async (prev, item, index) => {
      seen.push({ stage: 2, prev, item, index });
      return `${prev}-2`;
    },
  );
  expect(out).toEqual(["x-1-2", "y-1-2"]);
  // stage 1 sees prev === item (the original); stage 2 sees stage 1's return as prev, item unchanged.
  expect(seen).toContainEqual({ stage: 1, prev: "x", item: "x", index: 0 });
  expect(seen).toContainEqual({ stage: 2, prev: "x-1", item: "x", index: 0 });
  expect(seen).toContainEqual({ stage: 2, prev: "y-1", item: "y", index: 1 });
});
```

- [ ] **Step 6: Run runtime pipeline tests**

Run: `pnpm vitest run packages/core/src/runtime.pipeline.test.ts`
Expected: PASS (existing 2 + new test).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/runtime.ts packages/workflow/src/index.test.ts packages/core/src/runtime.pipeline.test.ts
git commit -m "feat(core): typed pipeline() via fixed-arity overloads"
```

---

## Task 2: zod-only authoring for `agent({ schema })`

**Files:**
- Modify: `packages/core/src/runtime.ts` (`AgentOptions.schema`, the schema-normalization block, remove `toJsonSchemaObject`)
- Modify: `packages/workflow/src/index.ts` (`agent` overloads — no schema→`unknown` shape)
- Modify: `packages/workflow/src/index.test.ts` (type test: plain-object schema is a type error)
- Modify: `packages/core/src/runtime.test.ts` (runtime: zod → JSON Schema in AgentRequest; non-zod → SchemaValidation)

- [ ] **Step 1: Add runtime tests (zod converted; non-zod rejected)**

In `packages/core/src/runtime.test.ts`, add a `describe("agent schema normalization", …)` (mirror the existing runtime test setup — capture the `AgentRequest` via a runner spy). Concretely:

```ts
it("converts a zod schema to JSON Schema in the emitted AgentRequest", async () => {
  let captured: AgentRequest | undefined;
  const runner: AgentRunner = {
    id: "spy",
    capabilities: { nativeSchema: true, reportsTokens: true, toolEvents: false },
    async run(req) {
      captured = req;
      return ok({ text: '{"n":1}', data: { n: 1 }, usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [] });
    },
  };
  const r = createRuntime({
    runner, semaphore: createSemaphore(1), journal: createJournal(),
    maxAgents: 10, budgetTotal: null, args: {}, cwd: "/tmp",
    runId: "r" as RunId, emit: () => {}, now: () => 0,
  });
  const out = await r.agent("p", { schema: z.object({ n: z.number() }) });
  expect(out).toEqual({ n: 1 });
  expect(captured?.schema).toBeDefined();
  expect(captured?.schema?.["type"]).toBe("object");
  expect((captured?.schema?.["properties"] as Record<string, unknown>)?.["n"]).toBeDefined();
});

it("fails with SchemaValidation when a non-zod schema object reaches agent()", async () => {
  const r = createRuntime({
    runner: createScriptedRunner({}), semaphore: createSemaphore(1), journal: createJournal(),
    maxAgents: 10, budgetTotal: null, args: {}, cwd: "/tmp",
    runId: "r" as RunId, emit: () => {}, now: () => 0,
  });
  // A plain JSON Schema object is only reachable from type-erased sandbox JS. Cast through
  // unknown to simulate that ingress without the (now zod-only) AgentOptions type complaining.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- simulate type-erased sandbox input
  const opts = { schema: { type: "object" } } as unknown as AgentOptions;
  await expect(r.agent("p", opts)).rejects.toMatchObject({ error: { kind: "SchemaValidation" } });
});
```

Notes: import `z` from `zod`, `ok` from `neverthrow`, and `AgentRequest`/`AgentRunner`/`AgentOptions` as needed. `WorkflowThrow` carries `.error`; if the existing tests assert thrown errors differently, match their pattern (e.g. `try/catch` reading `e.error.kind`).

- [ ] **Step 2: Verify the non-zod test fails (runtime currently accepts raw JSON Schema)**

Run: `pnpm vitest run packages/core/src/runtime.test.ts -t "non-zod"`
Expected: FAIL — today `toJsonSchemaObject` accepts the raw object, so no `SchemaValidation` is thrown.

- [ ] **Step 3: Narrow `AgentOptions.schema` to zod-only and require zod in the runtime**

In `packages/core/src/runtime.ts`:

Change the import (line 1) — `JsonSchema` and `isZodSchema`/`toJsonSchema` are still needed; `compileValidator`, `validate`, `ZodLike` stay:

```ts
import { validate, compileValidator, isZodSchema, toJsonSchema, type JsonSchema, type ZodLike } from "@workflow/schema";
```
(unchanged import line — keep as-is.)

Change `AgentOptions.schema` (line 24) from:
```ts
  readonly schema?: JsonSchema | ZodLike;
```
to:
```ts
  readonly schema?: ZodLike;
```

Delete the `toJsonSchemaObject` helper (lines 111–118) entirely.

Replace the normalization block (lines 219–235) with a zod-required version:

```ts
    // `opts.schema` must be a zod schema (the authoring surface is zod-only). Normalize it to
    // the JSON Schema the harnesses + AJV consume, and compile it here so a malformed schema
    // surfaces as a clean SchemaValidation error. A non-zod value is only reachable from
    // type-erased sandbox JS — reject it with the same error kind rather than guessing.
    let jsonSchema: JsonSchema | undefined;
    if (opts.schema) {
      try {
        if (!isZodSchema(opts.schema)) {
          throw new Error("agent({ schema }) requires a zod schema (e.g. z.object({ … }))");
        }
        const candidate = toJsonSchema(opts.schema);
        compileValidator(candidate);
        jsonSchema = candidate;
      } catch (cause) {
        const e: WorkflowError = { kind: "SchemaValidation", issues: [cause instanceof Error ? cause.message : String(cause)], attempts: 0 };
        deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
        throw new WorkflowThrow(e);
      }
    }
```

- [ ] **Step 4: Add the type-level test that a plain object schema is rejected**

In `packages/workflow/src/index.test.ts`, inside `describe("authoring surface", …)`:

```ts
it("rejects a plain JSON Schema object as a type error", () => {
  async function _typecheck(): Promise<void> {
    // @ts-expect-error a plain JSON Schema object is no longer assignable to schema (zod-only)
    await agent("p", { schema: { type: "object", properties: {} } });
  }
  expect(typeof _typecheck).toBe("function");
});
```

(The existing "infers agent's return type from a zod schema" and "returns unknown when no schema" tests stay unchanged — they already encode the two valid call shapes.)

- [ ] **Step 5: Update the `agent` overloads in `workflow/index.ts` (drop the schema→unknown shape)**

The current overloads (lines 50–53) already express the right shapes:
```ts
export function agent<T>(profile: Profile, prompt: string, opts: AgentOptions & { schema: z.ZodType<T> }): Promise<T>;
export function agent(profile: Profile, prompt: string, opts?: AgentOptions): Promise<unknown>;
export function agent<T>(prompt: string, opts: AgentOptions & { schema: z.ZodType<T> }): Promise<T>;
export function agent(prompt: string, opts?: AgentOptions): Promise<unknown>;
```
With `AgentOptions.schema` now `ZodLike`, `AgentOptions & { schema: z.ZodType<T> }` still narrows correctly and there is no call shape where a schema yields `unknown`. **No code change needed here** — confirm by re-reading after Task 2 Step 3, and verify the `@ts-expect-error` test passes.

- [ ] **Step 6: Run typecheck + the runtime tests**

Run: `pnpm build && pnpm --filter defineworkflow exec tsc --noEmit && pnpm vitest run packages/core/src/runtime.test.ts`
Expected: PASS — zod converts, non-zod throws `SchemaValidation`, `@ts-expect-error` is satisfied.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/runtime.ts packages/workflow/src/index.ts packages/workflow/src/index.test.ts packages/core/src/runtime.test.ts
git commit -m "feat(core): zod-only agent({ schema }) authoring"
```

---

## Task 3: `URL` / `URLSearchParams` in the sandbox

**Files:**
- Modify: `packages/core/src/sandbox.ts` (inject the globals)
- Modify: `packages/core/src/sandbox.test.ts` (a script using `new URL()` runs without ReferenceError)
- Modify: `packages/workflow/src/index.ts` (ambient `declare global` for the types)

- [ ] **Step 1: Add a sandbox test that `new URL()` works**

In `packages/core/src/sandbox.test.ts`, add a test that runs a workflow script calling `new URL(...)` and asserts no "URL is not defined" ReferenceError. Follow the file's existing `runInSandbox`/`transformScript` test setup. Minimal script body:

```ts
it("provides URL and URLSearchParams to workflow scripts", async () => {
  const source = `
import { defineWorkflow } from "defineworkflow";
export default defineWorkflow({
  name: "url-test",
  description: "uses URL",
  harness: "claude",
  async run() {
    const u = new URL("https://www.example.com/a/b?x=1");
    const sp = new URLSearchParams("a=1&b=2");
    return { host: u.hostname, path: u.pathname, x: u.searchParams.get("x"), a: sp.get("a") };
  },
});
`;
  const result = await runInSandbox(source, sandboxGlobalsForTest());
  expect(result.returnValue).toEqual({ host: "www.example.com", path: "/a/b", x: "1", a: "1" });
});
```

Match the existing test helpers in the file for how `globals` (the runtime primitives) are supplied — reuse whatever stub-globals factory the other `runInSandbox` tests use rather than inventing `sandboxGlobalsForTest`.

- [ ] **Step 2: Verify it fails (URL not injected)**

Run: `pnpm vitest run packages/core/src/sandbox.test.ts -t "URL"`
Expected: FAIL with "URL is not defined" ReferenceError.

- [ ] **Step 3: Inject `URL` and `URLSearchParams` into the sandbox globals**

In `packages/core/src/sandbox.ts`, in the `sandbox` object (~line 299–313), add the two host globals alongside the existing builtins:

```ts
  const sandbox: Record<string, unknown> = {
    ...globals,
    Math: bannedMath,
    Date: makeBannedDate(),
    __meta: undefined,
    Promise,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    console,
    URL,
    URLSearchParams,
  };
```

`URL`/`URLSearchParams` are Node globals at runtime (no import needed). They are deterministic (no clock/random) so they do not violate the replay invariant.

- [ ] **Step 4: Verify the sandbox test passes**

Run: `pnpm vitest run packages/core/src/sandbox.test.ts`
Expected: PASS.

- [ ] **Step 5: Ship the ambient `URL` types from `defineworkflow`**

In `packages/workflow/src/index.ts`, add an ambient global declaration (place it near the top after the imports, before `defineWorkflow`). Empirically verified to (a) not conflict with `@types/node` in the `workflow` typecheck and (b) resolve under `types: []` in examples:

```ts
// The sandbox injects `URL`/`URLSearchParams` as host globals (see @workflow/core's sandbox.ts).
// Declare them so a workflow file — which imports from `defineworkflow` and compiles with
// `types: []` — sees exactly the sandbox surface, without pulling in all of @types/node (which
// would falsely surface `process`/`fs`/`document`). `var` merges cleanly with @types/node's own
// global `URL` in this package's own typecheck.
declare global {
  // oxlint-disable no-var
  var URL: typeof import("node:url").URL;
  var URLSearchParams: typeof import("node:url").URLSearchParams;
  // oxlint-enable no-var
}
```

(If oxlint has no `no-var` rule active, drop the disable comments. Confirm via `pnpm lint`.)

- [ ] **Step 6: Verify workflow typecheck + dts still build**

Run: `pnpm build && pnpm --filter defineworkflow exec tsc --noEmit`
Expected: PASS. Then confirm the declaration is in the published types:
Run: `grep -n "URLSearchParams" packages/workflow/dist/index.d.ts`
Expected: the `declare global` block is present in the rolled-up `.d.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sandbox.ts packages/core/src/sandbox.test.ts packages/workflow/src/index.ts
git commit -m "feat(core): inject URL/URLSearchParams into the sandbox"
```

---

## Task 4: Example rewrites (cast-free)

**Files:**
- Modify: `packages/examples/src/deep-research.workflow.ts`
- Modify: `packages/examples/src/vue-newsletter.workflow.ts`
- Modify: `packages/examples/src/feature-pipeline.workflow.ts`

> Reminder: examples run in the sandbox (no `import` resolution at runtime — the `defineworkflow` import is stripped). Keep `defineWorkflow(...)` the FIRST runtime statement; zod schemas/`profile()` stay INSIDE `run()`. The `args` narrowing `as` cast STAYS in all three (documented convention). Examples are not tsc-checked in CI — verify via `--mock`.

- [ ] **Step 1: `feature-pipeline.workflow.ts` — remove the 3 pipeline-stage casts**

The pipeline now infers `subtask: Subtask` (items are `subtasks`, typed by `SubtasksSchema`'s inferred element) and each `prev`. Remove the three `oxlint-disable … consistent-type-assertions` comments + `as` casts in the stage callbacks (lines ~185–186, ~204–205, ~221–228). After removal each stage destructures the typed `prev`/`item` directly:

- Stage 1: `(_prev, subtask) => { const dir = \`${workspace}/${subtask.id}\`; … }` — `subtask` is `Subtask` (the `subtasks` element type). The local `interface Subtask` can stay as documentation but the cast is gone.
- Stage 2: `(prev) => { const { subtask, dir, tdd } = prev; … }` — `prev` is stage 1's return `{ subtask; dir; tdd }`.
- Stage 3: `(prev) => { const { subtask, dir, tdd, review } = prev; … }` — `prev` is stage 2's return.

Keep the `args` cast (lines ~125–126). Keep all prompts/logic identical.

- [ ] **Step 2: `vue-newsletter.workflow.ts` — convert JSON-Schema consts to zod, drop `JsonSchema` import + 2 casts**

- Change the import (line 20) to drop `type JsonSchema`:
  ```ts
  import { agent, args, defineWorkflow, log, parallel, phase, z } from "defineworkflow";
  ```
- Replace the `ITEM`/`SOURCE_RESULT`/`CURATED` plain-JSON-Schema consts (declared inside `run()`) with zod equivalents:
  ```ts
  const ITEM = z.object({
    title: z.string(),
    url: z.string(),
    summary: z.string().describe("1-3 sentence plain summary of what changed / why it matters"),
    category: z.enum(["release", "article", "tooling", "discussion", "tutorial", "people", "other"]),
    date: z.string().describe("ISO date if known, else empty"),
    impact: z.enum(["high", "medium", "low"]),
  });
  const SOURCE_RESULT = z.object({ source: z.string(), items: z.array(ITEM) });
  ```
  and (in the Curate phase):
  ```ts
  const CURATED = z.object({
    highlights: z.array(z.string()).describe("3-5 punchy bullets capturing the week's biggest stories"),
    items: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        summary: z.string(),
        category: z.string(),
        impact: z.enum(["high", "medium", "low"]),
      }),
    ),
  });
  ```
- Remove the `interface Item/SourceResult/Curated` type-only declarations (zod infers them now) OR keep them only if still referenced; prefer removing the ones made redundant. The `raw.filter((r): r is SourceResult => …)` becomes `raw.filter((r): r is z.infer<typeof SOURCE_RESULT> => r !== null)`.
- Remove the `as Curated` cast (lines ~180–184): `const curated = await agent(…, { phase: "Curate", schema: CURATED });` now infers `z.infer<typeof CURATED>`.
- Drop the now-stale comments that say "a schema is a plain JSON Schema object" / "CURATED is a plain JSON Schema (not zod)".

- [ ] **Step 3: `deep-research.workflow.ts` — async/await thunks, generic pipeline (no casts), `new URL()`**

This is the largest rewrite. Apply faithfully, preserving all defensive null-handling:

1. **`new URL()` in `hostOf`/`normURL`** (replace the regex parsers, lines ~173–181):
   ```ts
   const hostOf = (u: string): string | undefined => {
     try {
       return new URL(u).hostname.replace(/^www\./, "");
     } catch {
       return undefined;
     }
   };
   const normURL = (u: string): string => {
     try {
       const parsed = new URL(u);
       const host = parsed.hostname.replace(/^www\./, "");
       const path = parsed.pathname.replace(/\/$/, "");
       return (host + path).toLowerCase();
     } catch {
       return u.toLowerCase();
     }
   };
   ```
   Drop the comment "Parse with a regex rather than `new URL()`…".

2. **Generic pipeline — remove all three `as` casts.** With typed `pipeline`, stage 1's `prev`/`item` is the `scope.angles` element type (`{ label; query; rationale? }`); stage 2's `prev` is stage 1's return. Remove the `oxlint-disable … consistent-type-assertions` comment + `const angle = anglePrev as …` (stage 1) and `const searchResult = prev as AngleResults | null` (stage 2), and the post-pipeline `as Array<…>` cast (lines ~315–316). The result of `pipeline(...)` is now `Array<Array<FetchedSource | null> | null>` inferred — assign it directly to `const perAngle = searchResults;`.

3. **async/await thunks (no `.then`/`.catch`).** Convert every `.then(...)`/`.catch(...)` to `async`/`await` with `try/catch`:
   - Stage 1 becomes `async (angle) => { const r = await agent(SEARCH_PROMPT(angle), {…}); if (!r) return null; log(…); return { angle: angle.label, results: r.results } satisfies AngleResults; }`.
   - Stage 2 becomes `async (searchResult) => { if (!searchResult) return []; … return parallel(novel.map((source) => async () => { try { const ext = await agent(FETCH_PROMPT(source, searchResult.angle), {…}); if (!ext) return null; return {…}; } catch (e) { log(…); return { …, sourceQuality: "unreliable", claims: [] }; } })); }`. The fetch error path (previously `.catch`) is now the `catch` block — same fallback `FetchedSource`.
   - In the Verify section, the inner `parallel(...).then((verdicts) => {…})` becomes `async () => { const verdicts = await parallel(…); const valid = …; … return {…}; }`.
   - The synthesize `agent(...)` is already `await`ed.

4. **Rename to match the original `.js` harness conventions** (cosmetic but requested): schema consts `ScopeSchema→SCOPE_SCHEMA`, `SearchSchema→SEARCH_SCHEMA`, `ExtractSchema→EXTRACT_SCHEMA`, `VerdictSchema→VERDICT_SCHEMA`, `ReportSchema→REPORT_SCHEMA`; prompt fns `searchPrompt→SEARCH_PROMPT`, `fetchPrompt→FETCH_PROMPT`, `verifyPrompt→VERIFY_PROMPT`. Update all references (incl. `z.infer<typeof VERDICT_SCHEMA>`). State names `relRank`/`seen`/`dupes`/`budgetDropped`/`fetchSlots` already match — keep.

5. Keep the `args` cast (lines ~141–142), the local `interface` type-only declarations (still used to type `dupes`/`budgetDropped`/`FetchedSource` literals), and ALL defensive logic (user-skip → drop; verify abstentions quorum).

- [ ] **Step 4: Verify examples are cast-free (except the documented `args` cast)**

Run:
```bash
grep -n "consistent-type-assertions" packages/examples/src/deep-research.workflow.ts packages/examples/src/vue-newsletter.workflow.ts packages/examples/src/feature-pipeline.workflow.ts
```
Expected: exactly ONE hit per file — the `args` narrowing cast. No `JsonSchema` import remains:
```bash
grep -n "JsonSchema" packages/examples/src/*.workflow.ts
```
Expected: no hits.

- [ ] **Step 5: Verify examples still run end-to-end via `--mock`**

Run (after `pnpm build`):
```bash
node packages/workflow/dist/cli.js run packages/examples/src/feature-pipeline.workflow.ts --mock
node packages/workflow/dist/cli.js run packages/examples/src/vue-newsletter.workflow.ts --mock
node packages/workflow/dist/cli.js run packages/examples/src/deep-research.workflow.ts --mock
```
Expected: each completes and prints a returned object (no `SandboxViolation`, no `URL is not defined`, no schema errors). Use the installed bin if available (`pnpm --filter @workflow/examples exec defineworkflow run … --mock`).

- [ ] **Step 6: Commit**

```bash
git add packages/examples/src/deep-research.workflow.ts packages/examples/src/vue-newsletter.workflow.ts packages/examples/src/feature-pipeline.workflow.ts
git commit -m "refactor(examples): typed pipeline + zod-only schemas + new URL(), cast-free"
```

---

## Task 5: Docs

**Files:**
- Modify: `CLAUDE.md` (lines ~214–218)
- Modify: `.claude/skills/building-workflows/SKILL.md` (lines ~87, ~98–110, ~158)

- [ ] **Step 1: Update `CLAUDE.md` `agent({ schema })` description**

Replace the "accepts either a plain JSON Schema object or a zod schema … while a plain JSON Schema resolves to `unknown`" passage with zod-only wording: `agent({ schema })` accepts a **zod schema** (`z.object({ … })`) and returns the schema's inferred output type; without a schema the result is the raw text as `unknown`. The runtime converts zod → JSON Schema via `@workflow/schema`'s `toJsonSchema` at the boundary (JSON Schema remains the internal/harness format). Optionally note `pipeline()` is now typed and `URL`/`URLSearchParams` are available in the sandbox.

- [ ] **Step 2: Update the `building-workflows` skill**

- The table row (line ~87) and the "Structured output with zod" section already say zod; remove any lingering "or cast the text"/plain-JSON-Schema phrasing in the troubleshooting row (line ~158) that implies a non-zod schema path. Keep "Add a zod `schema`, or cast the text" only for the *no-schema* case.
- If the skill documents `pipeline()` as untyped or shows `prev as X` casts, update to the typed form (no cast). Add a one-line note that `new URL()` is available in the sandbox.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .claude/skills/building-workflows/SKILL.md
git commit -m "docs: zod-only schema, typed pipeline, URL in sandbox"
```

---

## Final gates (Step 5 verification)

Run in order; all must be green:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm knip
```

Plus the `--mock` runs of `deep-research` and `vue-newsletter` (Task 4 Step 5).

**Known pre-existing failures (out of scope, do NOT attribute to this work):** `packages/cli/src/orchestrator.test.ts` has 2 failures already present in the working tree. Confirm they are the SAME 2 failures before and after; everything else must pass.

**knip note:** removing the `JsonSchema` import from examples and the second silent schema path may trip knip. Re-check against `docs/solutions/developer-experience/knip-false-positives-in-this-monorepo.md` before "fixing" any finding — keep `JsonSchema`/`ZodLike` exported (still used internally / part of `AgentOptions`).

## Self-review checklist

1. **Spec coverage:** pipeline overloads (T1) ✓, zod-only (T2) ✓, URL sandbox + types (T3) ✓, all three example rewrites (T4) ✓, docs (T5) ✓, tests at every layer ✓.
2. **Type consistency:** `SCOPE_SCHEMA`/`SEARCH_SCHEMA`/`EXTRACT_SCHEMA`/`VERDICT_SCHEMA`/`REPORT_SCHEMA` + `SEARCH_PROMPT`/`FETCH_PROMPT`/`VERIFY_PROMPT` used consistently in deep-research; `z.infer<typeof SOURCE_RESULT>`/`z.infer<typeof CURATED>` in vue-newsletter; `AgentOptions.schema: ZodLike` matches the `agent` overloads' `AgentOptions & { schema: z.ZodType<T> }`.
3. **No placeholders:** every step has concrete code/commands.
</content>
</invoke>
