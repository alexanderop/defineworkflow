# type-fest Adoption for Deep Immutability + Shared Type Vocabulary — Implementation Plan

> **For agentic workers:** This is a **type-only** refactor. The compiler is the gate. Execute
> inline (the change is one tightly-coupled `pnpm typecheck` loop, not independent tasks);
> `references/executing-plans/SKILL.md` applies. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt `type-fest` as the repo's blessed type-utility vocabulary — routed through a single
`@workflow/core` module — to make core state structurally deep-immutable, harden ingress (parsed
JSON / CLI args) with `JsonValue`, and migrate nominal brands onto `Tagged`.

**Architecture:** One leaf re-export module `packages/core/src/type-ext.ts` owns the blessed
helpers (`Immutable`, `Mutable`, `Tagged`, `JsonValue`, `JsonObject`, `Simplify`, `Merge`,
`UnwrapTagged`). `type-fest` is a `dependency` of `@workflow/core` only; every other package
imports via `@workflow/core`. Core state types become `Immutable<…Shape>` so a future dropped
`readonly` is structurally impossible. Behavior is unchanged — nothing executes differently.

**Tech Stack:** TypeScript (strict, `Bundler` resolution, ESM), `type-fest@^4.41.0`, tsup, vitest,
oxlint. pnpm workspaces.

---

## Risks & invariants (carry through every task)

- **Build order / no cycle:** `type-ext.ts` must import _only_ from `type-fest` (no sibling core
  modules) so it stays a leaf re-export and `core` keeps emitting declarations before dependents.
- **`@workflow/core` must never depend on `@workflow/test-support`** (CLAUDE.md cycle rule). Unaffected here.
- **Reducer + `ReadonlyMap` inference** (`events.ts`) is the primary risk. `Immutable<Map<K,V>>`
  becomes `ReadonlyMap<K, Immutable<V>>`. The `new Map(state.agents)` copy, `.set(...)`, and array
  spreads (`[...a.tools, event.tool]`) must still typecheck. Drive iteratively with `pnpm typecheck`;
  tune the `…Shape` bases. `events.test.ts` is the behavioral safety net.
- **`Tagged<string,X>` passes through `ReadonlyDeep` unchanged** (it extends `string` ⇒ Primitive),
  so branded ids survive `Immutable`.
- Mint style stays `as` at trusted boundaries (existing `oxlint-disable` notes), not a runtime `tag()`.
- Don't run single-package vitest with `pnpm --filter` (root-anchored globs) — use a path filter
  from the repo root. Run `pnpm build` before `pnpm test` on a fresh tree.

---

## Task 1 — Add `type-fest`; create `type-ext.ts`; export from core index

**Files:**

- Modify: `packages/core/package.json` (add `type-fest` to `dependencies`)
- Create: `packages/core/src/type-ext.ts`
- Modify: `packages/core/src/index.ts` (re-export the vocabulary)

- [ ] **Step 1:** Add `"type-fest": "^4.41.0"` to `dependencies` in `packages/core/package.json`.
- [ ] **Step 2:** Create `packages/core/src/type-ext.ts`:

```ts
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

/** Deeply immutable view of T. The blessed way to type state & ingress data. */
export type Immutable<T> = ReadonlyDeep<T>;
/** Deeply mutable inverse — only for build-then-freeze locals. */
export type Mutable<T> = WritableDeep<T>;

export type { Tagged, UnwrapTagged, JsonValue, JsonObject, Simplify, Merge };
```

- [ ] **Step 3:** In `packages/core/src/index.ts` add (near the top, after the brand export):

```ts
export type {
  Immutable,
  Mutable,
  Tagged,
  UnwrapTagged,
  JsonValue,
  JsonObject,
  Simplify,
  Merge,
} from "./type-ext.js";
```

- [ ] **Step 4:** `pnpm install` (resolve `type-fest` into core's node_modules), then `pnpm --filter @workflow/core build`. Expected: declarations emit, no error.
- [ ] **Step 5:** Commit `feat(core): add type-fest vocabulary module (Immutable/Tagged/JsonValue)`.

## Task 2 — Migrate `brand.ts` (+ registry `ScriptHash`) to `Tagged`; drop `Brand`

**Files:**

- Modify: `packages/core/src/brand.ts`
- Modify: `packages/core/src/index.ts` (stop exporting `Brand`)
- Modify: `packages/cli/src/registry.ts` (`ScriptHash` → `Tagged`, drop `Brand` import)

- [ ] **Step 1:** Rewrite `brand.ts` onto `Tagged`, preserving the doc comments. The `Brand` alias
      is removed (only 3 usages, broad-adoption mandate):

```ts
import type { Tagged } from "type-fest";

/** A workflow run's unique id — minted by `genRunId`, used as its on-disk directory key. */
export type RunId = Tagged<string, "RunId">;

/**
 * An agent's composite identity, `` `${seq}:${phase}:${label}` `` — minted once per `agent()`
 * in the runtime and handed to the control registry / worktree factory. Distinct from the bare
 * `phase`/`label` strings it's built from, so they can't be passed where the full key is wanted.
 */
export type AgentKey = Tagged<string, "AgentKey">;
```

- [ ] **Step 2:** In `index.ts` change `export type { Brand, RunId, AgentKey } from "./brand.js";`
      to `export type { RunId, AgentKey } from "./brand.js";`
- [ ] **Step 3:** In `packages/cli/src/registry.ts`: drop `Brand` from the `@workflow/core` import,
      add `type Tagged`, and change `export type ScriptHash = Brand<string, "ScriptHash">;` to
      `export type ScriptHash = Tagged<string, "ScriptHash">;`
- [ ] **Step 4:** Verify the 4 mint sites still compile unchanged (`as` casts):
      `run-id.ts` (`as RunId`), `commands/run.ts:114` (`as ScriptHash`), `runtime.ts:159` (`as AgentKey`),
      `events.ts` initialRunState (`"" as RunId`). `AdapterId` untouched.
- [ ] **Step 5:** `pnpm build` then `pnpm typecheck`. Expected: green (the `as` mint sites narrow
      to `Tagged` the same way they did `Brand`).
- [ ] **Step 6:** Commit `refactor(core): migrate brands to type-fest Tagged, drop Brand alias`.

## Task 3 — Retrofit `events.ts` state types to `Immutable<…Shape>`

**Files:**

- Modify: `packages/core/src/events.ts`

- [ ] **Step 1:** Import the vocabulary: `import type { Immutable } from "./type-ext.js";`
- [ ] **Step 2:** Convert each state type to a mutable base shape exported as `Immutable<Shape>`.
      Remove hand-sprinkled `readonly`. Example for `RunState`:

```ts
interface AgentStateShape {
  key: string;
  label: string;
  phase: string;
  prompt: string;
  resultText: string;
  status: AgentStatus;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cached: boolean;
  approximate?: boolean;
  tools: ToolEvent[];
  queuedAt?: number;
  startedAt?: number;
  endedAt?: number;
  model?: string;
  liveTokens?: number;
  error?: WorkflowError;
}
export type AgentState = Immutable<AgentStateShape>;

interface PhaseStateShape {
  title: string;
  total: number;
  done: number;
  running: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
}
export type PhaseState = Immutable<PhaseStateShape>;

interface PendingQuestionShape {
  key: string;
  question: string;
  choices?: string[];
  allowOther?: boolean;
}
export type PendingQuestion = Immutable<PendingQuestionShape>;

interface RunStateShape {
  runId: RunId;
  name: string;
  status: "pending" | "running" | "finished";
  phases: Map<string, PhaseState>;
  agents: Map<string, AgentState>;
  pendingQuestion?: PendingQuestion;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  budgetTotal?: number | null;
  logs: string[];
  startedAt?: number;
  endedAt?: number;
}
export type RunState = Immutable<RunStateShape>;
```

Keep the `// retain the JSDoc` comments on the fields that have them (move them onto the shape fields).

- [ ] **Step 3:** Also convert the `WorkflowEvent` union, `ToolEvent`, `AgentProgress`, `AgentUsage`
      to mutable shapes wrapped in `Immutable` (point 3 of the design names the event variants). Write a
      `WorkflowEventShape` union of plain object shapes and `export type WorkflowEvent = Immutable<WorkflowEventShape>;`.
      **If this fights the `event()` factory in `@workflow/test-support` or adapter emit sites during
      typecheck (Task 8), scope WorkflowEvent back to its current per-field `readonly` form — it is
      already fully readonly, so the structural guard is the only thing lost, and the design marks the
      reducer retrofit (state types) as the critical path, not the events.**
- [ ] **Step 4:** Update `upsertPhase` signature so the map value type and patch callback use the
      (now `Immutable`) `PhaseState`:

```ts
function upsertPhase(
  phases: ReadonlyMap<string, PhaseState>,
  title: string,
  patch: (p: PhaseState) => PhaseState,
): Map<string, PhaseState> {
  const next = new Map(phases);
  const current = next.get(title) ?? {
    title,
    total: 0,
    done: 0,
    running: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  next.set(title, patch(current));
  return next;
}
```

- [ ] **Step 5:** Leave `reduce`'s body (spreads, `new Map(...)`, `[...a.tools, event.tool]`) and
      `initialRunState` (`"" as RunId`, empty `new Map()`s) **unchanged**. The `Map` constructor accepts
      a `ReadonlyMap`; mutable object literals are assignable to `Immutable<…>` slots.
- [ ] **Step 6:** `pnpm build` then `pnpm typecheck`. Iterate: if the reducer surfaces a
      `ReadonlyMap` value-type error, adjust the `…Shape` bases (e.g. array field element types) — do
      not weaken to `any`. Expected end state: green.
- [ ] **Step 7:** Run the reducer tests: `pnpm vitest run packages/core/src/events.test.ts`. Expected: PASS (behavior unchanged).
- [ ] **Step 8:** Commit `refactor(core): make RunState & friends structurally immutable via Immutable<Shape>`.

## Task 4 — Ingress hardening with `JsonValue` + `Immutable`

**Files:**

- Modify: `packages/cli/src/config.ts`
- Modify: `packages/cli/src/registry.ts`
- Modify: `packages/cli/src/node-deps.ts`
- Modify: `packages/cli/src/commands/run.ts`

- [ ] **Step 1:** `config.ts` — import `type JsonObject, type Immutable` from `@workflow/core`.
  - `isRecord`: `(v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v)`
  - `readJson` return type → `JsonObject`; `return isRecord(parsed) ? parsed : {};`
  - `loadConfig` return type → `Immutable<WorkflowConfig>`. The two `readJson(...) as WorkflowConfig`
    casts stay (keep their `oxlint-disable` notes) but now narrow from `JsonObject`.
- [ ] **Step 2:** `registry.ts` `readMeta` — import `type JsonValue, type Immutable`. Type the parse
      result and narrow:

```ts
const parsed: JsonValue = JSON.parse(raw);
// oxlint-disable-next-line typescript/consistent-type-assertions -- untyped JSON meta.json from disk narrowed to its persisted RunMeta shape
return parsed as unknown as Immutable<RunMeta>;
```

Update the `Registry.readMeta` interface return type and the local `readMeta` type to
`Immutable<RunMeta> | undefined`. `updateMeta`'s `{ ...current, ...patch }` still produces a fresh
object for `JSON.stringify`; `patch: Partial<RunMeta>` is unchanged.

- [ ] **Step 3:** `node-deps.ts:70` — type the parse as `JsonValue` then narrow to
      `Immutable<WorkflowConfig>` (keep the `oxlint-disable` note). The local `config` var that is later
      spread for `persistConsent` may need to stay a mutable `WorkflowConfig` for the `{ ...config, consents }`
      write — narrow the parsed value into the existing mutable local rather than retyping the local, to
      keep the write path intact.
- [ ] **Step 4:** `commands/run.ts:31` — `let parsedArgs: JsonValue = null;` (import `type JsonValue`
      from `@workflow/core`). `JSON.parse(args.argsJson)` assigns fine.
- [ ] **Step 5:** `pnpm build` then `pnpm typecheck`. Fix any narrowing fallout iteratively. Expected: green.
- [ ] **Step 6:** Commit `refactor(cli): type ingress boundaries with JsonValue + Immutable`.

## Task 5 — Authoring `args` → `Immutable<JsonValue>` (+ mirrors)

**Files:**

- Modify: `packages/workflow/src/index.ts` (`args` export)
- Modify: `packages/core/src/runtime.ts` (`Runtime.args`, `RuntimeDeps.args`)
- Modify: `packages/cli/src/registry.ts` (`RunMeta.args`)
- Modify: repo-owned examples if any read/mutate `args`

- [ ] **Step 1:** `workflow/index.ts`: change `export const args: unknown = undefined;` to
      `export const args: Immutable<JsonValue> = null;` (import `type Immutable, type JsonValue` from `@workflow/core`).
- [ ] **Step 2:** `runtime.ts`: `Runtime.args` and `RuntimeDeps.args` (currently `unknown`) →
      `Immutable<JsonValue>` (import the types from `./type-ext.js`). The runtime body
      `return { args: deps.args, … }` is unchanged. **Leave the `args?: unknown` _input parameters_
      (`LoadedWorkflow.run`, `resolveWorkflow`, `Runtime.workflow`, `workflow()`) as-is** — those are
      inbound positions; widening them is out of scope and changing them risks call-site churn. Only the
      _stored / exposed_ `args` fields become `Immutable<JsonValue>`.
- [ ] **Step 3:** `registry.ts`: `RunMeta.args` (`unknown`) → `Immutable<JsonValue>`.
- [ ] **Step 4:** Check `RunCtx` in `core/src/types.ts` — it has **no** `args` field, so nothing to
      change there. (The design's "mirrored on RunCtx/RunMeta.args" resolves to RunMeta only.)
- [ ] **Step 5:** Grep repo-owned workflows/examples for `args` mutation
      (`grep -rn "args" packages/examples/src`). Authors who do `args as Foo` still compile; only
      _mutation_ now errors. Update any repo example that mutates `args` (none expected).
- [ ] **Step 6:** `pnpm build` then `pnpm typecheck`. Expected: green. If `commands/run.ts` passes
      `parsedArgs: JsonValue` into a `RuntimeDeps.args: Immutable<JsonValue>` slot, that is assignable
      (mutable → readonly).
- [ ] **Step 7:** Commit `feat(workflow): type authoring args as Immutable<JsonValue>`.

## Task 6 — Ergonomics polish: `Simplify` + `Merge` (droppable)

**Files:**

- Modify: `packages/cli/src/app.ts` (capability `Pick<AppDeps, …>` slices)
- Modify: `packages/cli/src/config.ts` (`loadConfig` layering via `Merge`, if clean)

- [ ] **Step 1:** Wrap the command-layer `Pick<AppDeps, …>` capability slices in `app.ts` with
      `Simplify<…>` so hovers/errors render the resolved shape. Pure DX.
- [ ] **Step 2:** Express the config layering type with `Merge<WorkflowConfig, WorkflowConfig>` only
      if it reads cleanly; `mergeConsents` stays runtime code.
- [ ] **Step 3:** `pnpm typecheck`. **If either spot fights the change, drop it** — neither is on the
      immutability critical path.
- [ ] **Step 4:** Commit `chore(cli): Simplify/Merge ergonomics polish` (skip if both dropped).

## Task 7 — Update CLAUDE.md conventions

**Files:**

- Modify: `CLAUDE.md` ("TypeScript conventions" section)

- [ ] **Step 1:** Add guidance: new state/data types → write a mutable `…Shape` base and export
      `Immutable<Shape>` from `@workflow/core`; new nominal types → `Tagged<Base, "Name">`; parsed/ingress
      data → `JsonValue` + `Immutable`. Note the existing `consistent-type-assertions: "never"` rule
      already blocks an `as Mutable<T>` escape hatch. Mention `type-fest` is routed through
      `@workflow/core` only.
- [ ] **Step 2:** Commit `docs: document type-fest immutability conventions in CLAUDE.md`.

## Task 8 — Full verification + knip

- [ ] **Step 1:** `pnpm build` — core emits first (no cycle). Expected: success.
- [ ] **Step 2:** `pnpm typecheck` — the real gate. Expected: green across all 9 projects.
- [ ] **Step 3:** `pnpm test` — unit suite. Expected: all green (367+ pass), `events.test.ts` confirms
      unchanged reducer behavior.
- [ ] **Step 4:** `pnpm lint` — no new `consistent-type-assertions` violations.
- [ ] **Step 5:** `pnpm knip` — confirm `type-fest` in `@workflow/core` is not reported as unused
      (it is used in `import type` positions, which knip detects). If knip flags it, consult
      `docs/solutions/developer-experience/knip-false-positives-in-this-monorepo.md` before acting.
- [ ] **Step 6:** Final commit if any residual fixes; push branch.

---

## Self-review

- **Spec coverage:** Task 1 = §Design.1 (vocabulary module + dep); Task 2 = §Design.2 (Tagged);
  Task 3 = §Design.3 (Immutable state); Task 4 = §Design.4 (ingress); Task 5 = §Design.4 public-API
  `args`; Task 6 = §Design.5 (Simplify/Merge); Task 7 = §Design.6 (docs); Task 8 = §Verification.
  `compound` doc happens post-plan in the lfg pipeline (Step 8). ✓
- **Type consistency:** `Immutable`/`Mutable`/`Tagged`/`JsonValue`/`JsonObject`/`Simplify`/`Merge`
  are the exact names defined in Task 1 and reused verbatim throughout. ✓
- **No placeholders:** every code-changing step shows the code or the exact rename. ✓
