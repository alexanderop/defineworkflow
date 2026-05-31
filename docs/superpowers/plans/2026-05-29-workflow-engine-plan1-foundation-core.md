# Workflow Engine — Plan 1: Foundation + Core Orchestration Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo scaffold, `@workflow/schema`, and `@workflow/core` — a deterministic multi-agent orchestration engine (primitives, sandbox, scheduler, journal/resume, budget, event bus) that is fully unit- and integration-tested against an in-memory `ScriptedRunner`, with no real coding-harness adapters yet.

**Architecture:** Pure functional core with effects pushed to the edges. The engine executes a workflow script inside a `node:vm` sandbox (non-deterministic globals banned), delegates each `agent()` call to an injected `AgentRunner`, bounds concurrency with a semaphore, and journals every call so runs are resumable. Errors are values (`Result<T, WorkflowError>` via neverthrow); the authoring boundary stays parity-faithful (value/throw).

**Tech Stack:** pnpm workspace, Turborepo, TypeScript (strict), tsup (build), Vitest (projects), oxlint, Zod v4 (`z.toJSONSchema`), neverthrow, esbuild (script transform).

> **Naming note:** packages use the placeholder scope `@workflow/*`. Rename the scope before publishing.

---

## File Structure (Plan 1)

```
workflow/
├─ package.json                      # root, workspace scripts, devDeps
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ turbo.json
├─ vitest.config.ts                  # projects: unit, integration (e2e excluded)
├─ .oxlintrc.json
├─ .gitignore
└─ packages/
   ├─ schema/
   │  ├─ package.json
   │  ├─ tsconfig.json
   │  ├─ src/index.ts                # toJsonSchema, validate, JsonSchema, SchemaError
   │  └─ src/index.test.ts
   └─ core/
      ├─ package.json
      ├─ tsconfig.json
      └─ src/
         ├─ index.ts                 # public exports
         ├─ errors.ts                # WorkflowError, Result re-exports
         ├─ types.ts                 # AgentRunner, AgentRequest/Result, options
         ├─ budget.ts                # createBudget
         ├─ semaphore.ts             # createSemaphore
         ├─ events.ts                # WorkflowEvent, RunState, reduce
         ├─ journal.ts               # createJournal (in-memory)
         ├─ sandbox.ts               # transformScript, runInSandbox
         ├─ runtime.ts               # createRuntime — the primitives
         ├─ scripted-runner.ts       # ScriptedRunner test helper
         └─ *.test.ts                # co-located tests
```

---

## Phase 0 — Monorepo scaffold

### Task 1: pnpm workspace + root config

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `turbo.json`
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
coverage/
.turbo/
*.tsbuildinfo
.workflow/
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "examples"
```

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "workflow-monorepo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "oxlint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "WORKFLOW_E2E=1 vitest run --project e2e"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "oxlint": "^0.11.0",
    "tsup": "^8.3.0",
    "turbo": "^2.2.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@vitest/coverage-v8": "^2.1.0"
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 5: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] }
  }
}
```

- [ ] **Step 6: Install and verify**

Run: `pnpm install`
Expected: completes without error, creates `pnpm-lock.yaml`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: pnpm workspace + turborepo scaffold"
```

### Task 2: oxlint config

**Files:**

- Create: `.oxlintrc.json`

- [ ] **Step 1: Create `.oxlintrc.json`** (correctness + FP/immutability-leaning rules)

```json
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
  "categories": { "correctness": "error", "suspicious": "warn" },
  "rules": {
    "no-param-reassign": "error",
    "prefer-const": "error",
    "no-var": "error",
    "eqeqeq": "error"
  },
  "ignorePatterns": ["dist", "coverage", "node_modules", ".turbo"]
}
```

- [ ] **Step 2: Run lint to verify config loads**

Run: `pnpm lint`
Expected: runs and reports "Found 0 warnings and 0 errors" (no source yet).

- [ ] **Step 3: Commit**

```bash
git add .oxlintrc.json
git commit -m "chore: add oxlint config"
```

### Task 3: Vitest projects config

**Files:**

- Create: `vitest.config.ts`

- [ ] **Step 1: Create `vitest.config.ts`** — default run excludes e2e via a named project

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts"],
          exclude: ["**/*.e2e.test.ts"],
        },
      },
      {
        test: {
          name: "e2e",
          include: ["packages/*/src/**/*.e2e.test.ts"],
        },
      },
    ],
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
```

> Note: `pnpm test` runs every project listed. We keep e2e out of the default flow via the `test:e2e` script targeting `--project e2e`, and e2e tests self-skip unless `WORKFLOW_E2E=1` (added in Plan 2/4). For Plan 1 there are no e2e files yet.

- [ ] **Step 2: Verify Vitest starts**

Run: `pnpm test`
Expected: "No test files found" (or runs 0 tests) — exits 0 once at least the config is valid. (If Vitest errors on zero files, that's fine; the next task adds real tests.)

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: vitest projects config (unit + e2e split)"
```

---

## Phase 1 — `@workflow/schema`

### Task 4: schema package skeleton

**Files:**

- Create: `packages/schema/package.json`
- Create: `packages/schema/tsconfig.json`
- Create: `packages/schema/src/index.ts`

- [ ] **Step 1: Create `packages/schema/package.json`**

```json
{
  "name": "@workflow/schema",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "neverthrow": "^8.1.0", "zod": "^4.0.0" }
}
```

- [ ] **Step 2: Create `packages/schema/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create placeholder `packages/schema/src/index.ts`**

```ts
export type Placeholder = never;
```

- [ ] **Step 4: Install deps**

Run: `pnpm install`
Expected: installs `zod` and `neverthrow` into the schema package.

- [ ] **Step 5: Commit**

```bash
git add packages/schema
git commit -m "chore: scaffold @workflow/schema package"
```

### Task 5: `toJsonSchema` — Zod → JSON Schema

**Files:**

- Modify: `packages/schema/src/index.ts`
- Test: `packages/schema/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { toJsonSchema } from "./index.js";

describe("toJsonSchema", () => {
  it("converts a zod object to a JSON Schema with properties", () => {
    const schema = z.object({ title: z.string(), count: z.number() });
    const result = toJsonSchema(schema);
    expect(result.isOk()).toBe(true);
    const json = result._unsafeUnwrap();
    expect(json.type).toBe("object");
    expect(Object.keys(json.properties as object)).toEqual(["title", "count"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/schema/src/index.test.ts`
Expected: FAIL — `toJsonSchema is not a function`.

- [ ] **Step 3: Implement in `packages/schema/src/index.ts`**

```ts
import { z } from "zod";
import { ok, err, type Result } from "neverthrow";

export type JsonSchema = Record<string, unknown>;

export type SchemaError =
  | { readonly kind: "Conversion"; readonly cause: string }
  | { readonly kind: "Validation"; readonly issues: readonly string[] };

export function toJsonSchema(schema: z.ZodType): Result<JsonSchema, SchemaError> {
  try {
    return ok(z.toJSONSchema(schema) as JsonSchema);
  } catch (e) {
    return err({ kind: "Conversion", cause: e instanceof Error ? e.message : String(e) });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/schema/src/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schema/src
git commit -m "feat(schema): zod to JSON Schema conversion"
```

### Task 6: `validate` — runtime validation returning Result

**Files:**

- Modify: `packages/schema/src/index.ts`
- Test: `packages/schema/src/index.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
import { validate } from "./index.js";

describe("validate", () => {
  const schema = z.object({ title: z.string() });

  it("returns Ok with typed data on valid input", () => {
    const r = validate(schema, { title: "hi" });
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap()).toEqual({ title: "hi" });
  });

  it("returns Err with readable issues on invalid input", () => {
    const r = validate(schema, { title: 42 });
    expect(r.isErr()).toBe(true);
    const e = r._unsafeUnwrapErr();
    expect(e.kind).toBe("Validation");
    expect(e.kind === "Validation" && e.issues.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/schema/src/index.test.ts`
Expected: FAIL — `validate is not a function`.

- [ ] **Step 3: Add `validate` to `packages/schema/src/index.ts`**

```ts
export function validate<T>(schema: z.ZodType<T>, value: unknown): Result<T, SchemaError> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  return err({
    kind: "Validation",
    issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/schema/src/index.test.ts`
Expected: PASS (all schema tests green).

- [ ] **Step 5: Build + commit**

```bash
pnpm --filter @workflow/schema build
git add packages/schema/src
git commit -m "feat(schema): runtime validate returning Result"
```

---

## Phase 2 — `@workflow/core`

### Task 7: core package skeleton

**Files:**

- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@workflow/core",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@workflow/schema": "workspace:*",
    "neverthrow": "^8.1.0",
    "zod": "^4.0.0",
    "esbuild": "^0.24.0"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create placeholder `packages/core/src/index.ts`**

```ts
export {};
```

- [ ] **Step 4: Install + commit**

Run: `pnpm install`

```bash
git add packages/core
git commit -m "chore: scaffold @workflow/core package"
```

### Task 8: errors + Result re-exports

**Files:**

- Create: `packages/core/src/errors.ts`
- Test: `packages/core/src/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { ok, err, type WorkflowError } from "./errors.js";

describe("errors", () => {
  it("re-exports neverthrow ok/err", () => {
    expect(ok(1).isOk()).toBe(true);
    expect(err("x").isErr()).toBe(true);
  });

  it("WorkflowError is a discriminated union matchable by kind", () => {
    const e: WorkflowError = { kind: "BudgetExhausted", spent: 10, total: 5 };
    expect(e.kind === "BudgetExhausted" && e.spent).toBe(10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/core/src/errors.test.ts`
Expected: FAIL — cannot find `./errors.js`.

- [ ] **Step 3: Create `packages/core/src/errors.ts`**

```ts
export { ok, err, Result, ResultAsync, okAsync, errAsync } from "neverthrow";

export type WorkflowError =
  | { readonly kind: "AdapterSpawn"; readonly adapter: string; readonly cause: string }
  | {
      readonly kind: "SchemaValidation";
      readonly issues: readonly string[];
      readonly attempts: number;
    }
  | { readonly kind: "SandboxViolation"; readonly api: string }
  | { readonly kind: "JournalCorrupt"; readonly runId: string; readonly detail: string }
  | { readonly kind: "BudgetExhausted"; readonly spent: number; readonly total: number }
  | { readonly kind: "AgentCapExceeded"; readonly cap: number };

/** Thrown across the sandbox boundary only; carries a typed WorkflowError. */
export class WorkflowThrow extends Error {
  constructor(readonly workflowError: WorkflowError) {
    super(`${workflowError.kind}`);
    this.name = "WorkflowThrow";
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/errors.ts packages/core/src/errors.test.ts
git commit -m "feat(core): WorkflowError union + Result re-exports"
```

### Task 9: budget

**Files:**

- Create: `packages/core/src/budget.ts`
- Test: `packages/core/src/budget.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createBudget } from "./budget.js";

describe("budget", () => {
  it("tracks spend and remaining when a total is set", () => {
    const b = createBudget(100);
    expect(b.total).toBe(100);
    expect(b.remaining()).toBe(100);
    b.record(30);
    expect(b.spent()).toBe(30);
    expect(b.remaining()).toBe(70);
  });

  it("never reports negative remaining", () => {
    const b = createBudget(10);
    b.record(50);
    expect(b.remaining()).toBe(0);
  });

  it("reports Infinity remaining when total is null", () => {
    const b = createBudget(null);
    b.record(999);
    expect(b.remaining()).toBe(Infinity);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/core/src/budget.test.ts`
Expected: FAIL — cannot find `./budget.js`.

- [ ] **Step 3: Create `packages/core/src/budget.ts`**

```ts
export interface Budget {
  readonly total: number | null;
  spent(): number;
  remaining(): number;
  record(outputTokens: number): void;
}

export function createBudget(total: number | null): Budget {
  let used = 0;
  return {
    total,
    spent: () => used,
    remaining: () => (total === null ? Infinity : Math.max(0, total - used)),
    record: (outputTokens) => {
      used += outputTokens;
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/budget.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/budget.ts packages/core/src/budget.test.ts
git commit -m "feat(core): token budget tracking"
```

### Task 10: concurrency semaphore

**Files:**

- Create: `packages/core/src/semaphore.ts`
- Test: `packages/core/src/semaphore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createSemaphore } from "./semaphore.js";

describe("semaphore", () => {
  it("never lets more than `limit` holders run at once", async () => {
    const sem = createSemaphore(2);
    let active = 0;
    let peak = 0;
    const task = async () => {
      const release = await sem.acquire();
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      release();
    };
    await Promise.all(Array.from({ length: 10 }, task));
    expect(peak).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/core/src/semaphore.test.ts`
Expected: FAIL — cannot find `./semaphore.js`.

- [ ] **Step 3: Create `packages/core/src/semaphore.ts`**

```ts
export interface Semaphore {
  acquire(): Promise<() => void>;
}

export function createSemaphore(limit: number): Semaphore {
  let available = limit;
  const waiters: Array<() => void> = [];

  const release = (): void => {
    available++;
    const next = waiters.shift();
    if (next) {
      available--;
      next();
    }
  };

  return {
    acquire: () =>
      new Promise<() => void>((resolve) => {
        if (available > 0) {
          available--;
          resolve(release);
        } else {
          waiters.push(() => resolve(release));
        }
      }),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/semaphore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/semaphore.ts packages/core/src/semaphore.test.ts
git commit -m "feat(core): bounded concurrency semaphore"
```

### Task 11: event types + pure reducer

**Files:**

- Create: `packages/core/src/events.ts`
- Test: `packages/core/src/events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { reduce, initialRunState, type WorkflowEvent } from "./events.js";

describe("event reducer", () => {
  it("accumulates phase counts and tokens from an event stream", () => {
    const events: WorkflowEvent[] = [
      { type: "run-started", runId: "r1", name: "demo", at: 0 },
      { type: "phase-started", phase: "Search", at: 1 },
      { type: "agent-queued", key: "0", label: "a", phase: "Search", at: 2 },
      { type: "agent-started", key: "0", at: 3 },
      {
        type: "agent-finished",
        key: "0",
        usage: { inputTokens: 5, outputTokens: 10 },
        cached: false,
        at: 4,
      },
    ];
    const state = events.reduce(reduce, initialRunState());
    const phase = state.phases.get("Search")!;
    expect(phase.total).toBe(1);
    expect(phase.done).toBe(1);
    expect(state.totalTokens).toBe(15);
  });

  it("is pure — does not mutate the input state", () => {
    const s0 = initialRunState();
    reduce(s0, { type: "phase-started", phase: "X", at: 0 });
    expect(s0.phases.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/core/src/events.test.ts`
Expected: FAIL — cannot find `./events.js`.

- [ ] **Step 3: Create `packages/core/src/events.ts`**

```ts
import type { WorkflowError } from "./errors.js";

export interface ToolEvent {
  readonly name: string;
  readonly input?: unknown;
}

export interface AgentUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly approximate?: boolean;
}

export type WorkflowEvent =
  | {
      readonly type: "run-started";
      readonly runId: string;
      readonly name: string;
      readonly at: number;
    }
  | { readonly type: "phase-started"; readonly phase: string; readonly at: number }
  | {
      readonly type: "agent-queued";
      readonly key: string;
      readonly label: string;
      readonly phase: string;
      readonly at: number;
    }
  | { readonly type: "agent-started"; readonly key: string; readonly at: number }
  | {
      readonly type: "agent-tool";
      readonly key: string;
      readonly tool: ToolEvent;
      readonly at: number;
    }
  | {
      readonly type: "agent-finished";
      readonly key: string;
      readonly usage: AgentUsage;
      readonly cached: boolean;
      readonly at: number;
    }
  | {
      readonly type: "agent-failed";
      readonly key: string;
      readonly error: WorkflowError;
      readonly at: number;
    }
  | { readonly type: "log"; readonly message: string; readonly at: number }
  | { readonly type: "run-finished"; readonly runId: string; readonly at: number };

export type AgentStatus = "queued" | "running" | "done" | "failed";

export interface AgentState {
  readonly key: string;
  readonly label: string;
  readonly phase: string;
  readonly status: AgentStatus;
  readonly tokens: number;
  readonly tools: readonly ToolEvent[];
}

export interface PhaseState {
  readonly title: string;
  readonly total: number;
  readonly done: number;
  readonly running: number;
  readonly tokens: number;
}

export interface RunState {
  readonly runId: string;
  readonly name: string;
  readonly status: "pending" | "running" | "finished";
  readonly phases: ReadonlyMap<string, PhaseState>;
  readonly agents: ReadonlyMap<string, AgentState>;
  readonly totalTokens: number;
  readonly logs: readonly string[];
}

export function initialRunState(): RunState {
  return {
    runId: "",
    name: "",
    status: "pending",
    phases: new Map(),
    agents: new Map(),
    totalTokens: 0,
    logs: [],
  };
}

function upsertPhase(
  phases: ReadonlyMap<string, PhaseState>,
  title: string,
  patch: (p: PhaseState) => PhaseState,
): Map<string, PhaseState> {
  const next = new Map(phases);
  const current = next.get(title) ?? { title, total: 0, done: 0, running: 0, tokens: 0 };
  next.set(title, patch(current));
  return next;
}

export function reduce(state: RunState, event: WorkflowEvent): RunState {
  switch (event.type) {
    case "run-started":
      return { ...state, runId: event.runId, name: event.name, status: "running" };
    case "phase-started":
      return { ...state, phases: upsertPhase(state.phases, event.phase, (p) => p) };
    case "agent-queued": {
      const agents = new Map(state.agents);
      agents.set(event.key, {
        key: event.key,
        label: event.label,
        phase: event.phase,
        status: "queued",
        tokens: 0,
        tools: [],
      });
      return {
        ...state,
        agents,
        phases: upsertPhase(state.phases, event.phase, (p) => ({ ...p, total: p.total + 1 })),
      };
    }
    case "agent-started": {
      const a = state.agents.get(event.key);
      if (!a) return state;
      const agents = new Map(state.agents);
      agents.set(event.key, { ...a, status: "running" });
      return {
        ...state,
        agents,
        phases: upsertPhase(state.phases, a.phase, (p) => ({ ...p, running: p.running + 1 })),
      };
    }
    case "agent-tool": {
      const a = state.agents.get(event.key);
      if (!a) return state;
      const agents = new Map(state.agents);
      agents.set(event.key, { ...a, tools: [...a.tools, event.tool] });
      return { ...state, agents };
    }
    case "agent-finished": {
      const a = state.agents.get(event.key);
      if (!a) return state;
      const tokens = event.usage.inputTokens + event.usage.outputTokens;
      const agents = new Map(state.agents);
      agents.set(event.key, { ...a, status: "done", tokens });
      return {
        ...state,
        agents,
        totalTokens: state.totalTokens + tokens,
        phases: upsertPhase(state.phases, a.phase, (p) => ({
          ...p,
          done: p.done + 1,
          running: Math.max(0, p.running - (event.cached ? 0 : 1)),
          tokens: p.tokens + tokens,
        })),
      };
    }
    case "agent-failed": {
      const a = state.agents.get(event.key);
      if (!a) return state;
      const agents = new Map(state.agents);
      agents.set(event.key, { ...a, status: "failed" });
      return {
        ...state,
        agents,
        phases: upsertPhase(state.phases, a.phase, (p) => ({
          ...p,
          running: Math.max(0, p.running - 1),
        })),
      };
    }
    case "log":
      return { ...state, logs: [...state.logs, event.message] };
    case "run-finished":
      return { ...state, status: "finished" };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/events.ts packages/core/src/events.test.ts
git commit -m "feat(core): workflow event types + pure run-state reducer"
```

### Task 12: AgentRunner types + ScriptedRunner test helper

**Files:**

- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/scripted-runner.ts`
- Test: `packages/core/src/scripted-runner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createScriptedRunner } from "./scripted-runner.js";

describe("ScriptedRunner", () => {
  it("returns canned results matched by label, with default usage", async () => {
    const runner = createScriptedRunner({
      "research:a": { text: "found A", data: { items: 1 }, outputTokens: 12 },
    });
    const ctrl = new AbortController();
    const res = await runner.run(
      { prompt: "p", cwd: "/tmp", signal: ctrl.signal, label: "research:a" },
      { runId: "r", seq: 0 },
    );
    expect(res.isOk()).toBe(true);
    const r = res._unsafeUnwrap();
    expect(r.text).toBe("found A");
    expect(r.data).toEqual({ items: 1 });
    expect(r.usage.outputTokens).toBe(12);
  });

  it("tracks peak concurrency via inFlight()", async () => {
    const runner = createScriptedRunner({}, { delayMs: 10 });
    const ctrl = new AbortController();
    const reqs = Array.from({ length: 3 }, (_, i) =>
      runner.run(
        { prompt: "p", cwd: "/tmp", signal: ctrl.signal, label: `x${i}` },
        { runId: "r", seq: i },
      ),
    );
    await new Promise((r) => setTimeout(r, 2));
    expect(runner.inFlight()).toBe(3);
    await Promise.all(reqs);
    expect(runner.inFlight()).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/core/src/scripted-runner.test.ts`
Expected: FAIL — cannot find `./scripted-runner.js`.

- [ ] **Step 3: Create `packages/core/src/types.ts`**

```ts
import type { Result } from "neverthrow";
import type { WorkflowError } from "./errors.js";
import type { AgentUsage, ToolEvent } from "./events.js";

export type JsonSchema = Record<string, unknown>;

export interface AgentRequest {
  readonly prompt: string;
  readonly schema?: JsonSchema;
  readonly model?: string;
  readonly agentType?: string;
  readonly label?: string;
  readonly cwd: string;
  readonly signal: AbortSignal;
}

export interface AgentResult {
  readonly text: string;
  readonly data?: unknown;
  readonly usage: AgentUsage;
  readonly toolCalls: readonly ToolEvent[];
}

export interface RunCtx {
  readonly runId: string;
  readonly seq: number;
}

export interface AgentRunner {
  readonly id: string;
  readonly capabilities: {
    readonly nativeSchema: boolean;
    readonly reportsTokens: boolean;
    readonly toolEvents: boolean;
  };
  run(req: AgentRequest, ctx: RunCtx): Promise<Result<AgentResult, WorkflowError>>;
}
```

- [ ] **Step 4: Create `packages/core/src/scripted-runner.ts`**

```ts
import { ok, err } from "neverthrow";
import type { AgentRunner, AgentRequest, AgentResult, RunCtx } from "./types.js";
import type { WorkflowError } from "./errors.js";
import type { Result } from "neverthrow";

export interface ScriptedResponse {
  readonly text?: string;
  readonly data?: unknown;
  readonly outputTokens?: number;
  readonly inputTokens?: number;
  readonly fail?: WorkflowError;
}

export interface ScriptedRunnerOptions {
  /** Artificial delay so concurrency can be observed in tests. */
  readonly delayMs?: number;
}

export interface ScriptedRunner extends AgentRunner {
  inFlight(): number;
  callCount(): number;
}

/** Deterministic in-memory runner for engine tests. Matches responses by request label. */
export function createScriptedRunner(
  responses: Readonly<Record<string, ScriptedResponse>>,
  options: ScriptedRunnerOptions = {},
): ScriptedRunner {
  const delayMs = options.delayMs ?? 0;
  let active = 0;
  let calls = 0;

  const run = async (
    req: AgentRequest,
    _ctx: RunCtx,
  ): Promise<Result<AgentResult, WorkflowError>> => {
    active++;
    calls++;
    try {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const spec = responses[req.label ?? ""] ?? {};
      if (spec.fail) return err(spec.fail);
      return ok({
        text: spec.text ?? "",
        data: spec.data,
        usage: { inputTokens: spec.inputTokens ?? 0, outputTokens: spec.outputTokens ?? 0 },
        toolCalls: [],
      });
    } finally {
      active--;
    }
  };

  return {
    id: "scripted",
    capabilities: { nativeSchema: true, reportsTokens: true, toolEvents: false },
    run,
    inFlight: () => active,
    callCount: () => calls,
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/scripted-runner.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/scripted-runner.ts packages/core/src/scripted-runner.test.ts
git commit -m "feat(core): AgentRunner contract + ScriptedRunner test helper"
```

### Task 13: journal (in-memory store)

**Files:**

- Create: `packages/core/src/journal.ts`
- Test: `packages/core/src/journal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createJournal } from "./journal.js";

describe("journal", () => {
  it("returns a miss before record, a hit after, keyed by seq", () => {
    const j = createJournal();
    expect(j.lookup(0)).toBeUndefined();
    j.record({ seq: 0, key: "0:Search:a", data: { found: true }, text: "x", outputTokens: 9 });
    const hit = j.lookup(0);
    expect(hit?.data).toEqual({ found: true });
    expect(hit?.outputTokens).toBe(9);
  });

  it("serializes to and from JSONL records", () => {
    const j = createJournal();
    j.record({ seq: 0, key: "0:P:a", data: 1, text: "", outputTokens: 0 });
    j.record({ seq: 1, key: "1:P:b", data: 2, text: "", outputTokens: 0 });
    const restored = createJournal(j.entries());
    expect(restored.lookup(1)?.data).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/core/src/journal.test.ts`
Expected: FAIL — cannot find `./journal.js`.

- [ ] **Step 3: Create `packages/core/src/journal.ts`**

```ts
export interface JournalEntry {
  readonly seq: number;
  readonly key: string;
  readonly text: string;
  readonly data: unknown;
  readonly outputTokens: number;
}

export interface Journal {
  lookup(seq: number): JournalEntry | undefined;
  record(entry: JournalEntry): void;
  entries(): readonly JournalEntry[];
}

export function createJournal(seed: readonly JournalEntry[] = []): Journal {
  const bySeq = new Map<number, JournalEntry>();
  for (const e of seed) bySeq.set(e.seq, e);
  return {
    lookup: (seq) => bySeq.get(seq),
    record: (entry) => {
      bySeq.set(entry.seq, entry);
    },
    entries: () => [...bySeq.values()].sort((a, b) => a.seq - b.seq),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/journal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/journal.ts packages/core/src/journal.test.ts
git commit -m "feat(core): in-memory journal with seq keying + JSONL round-trip"
```

### Task 14: sandbox (transform + vm + banned globals)

**Files:**

- Create: `packages/core/src/sandbox.ts`
- Test: `packages/core/src/sandbox.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { runInSandbox } from "./sandbox.js";

describe("sandbox", () => {
  it("extracts meta and returns the script's return value", async () => {
    const src = `
      export const meta = { name: "demo", description: "d", phases: [] };
      const a = await getValue();
      return { a };
    `;
    const result = await runInSandbox(src, { getValue: async () => 42 });
    expect(result.meta.name).toBe("demo");
    expect(result.returnValue).toEqual({ a: 42 });
  });

  it("throws SandboxViolation when the script calls Date.now()", async () => {
    const src = `export const meta = { name: "x", description: "", phases: [] };\n const t = Date.now(); return t;`;
    await expect(runInSandbox(src, {})).rejects.toThrow(/SandboxViolation|Date.now/);
  });

  it("throws SandboxViolation when the script calls Math.random()", async () => {
    const src = `export const meta = { name: "x", description: "", phases: [] };\n return Math.random();`;
    await expect(runInSandbox(src, {})).rejects.toThrow(/SandboxViolation|Math.random/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/core/src/sandbox.test.ts`
Expected: FAIL — cannot find `./sandbox.js`.

- [ ] **Step 3: Create `packages/core/src/sandbox.ts`**

```ts
import vm from "node:vm";
import { transformSync } from "esbuild";

export interface SandboxResult {
  readonly meta: {
    readonly name: string;
    readonly description: string;
    readonly phases?: readonly unknown[];
  };
  readonly returnValue: unknown;
}

/**
 * Transform a workflow script into a runnable async IIFE.
 * - `export const meta = …` becomes a capture into __captureMeta(…)
 * - the trailing top-level `return` is valid because the body runs inside an async arrow
 * - TS is stripped by esbuild
 */
export function transformScript(source: string): string {
  const captured = source.replace(
    /export\s+const\s+meta\s*=/,
    "const meta = globalThis.__captureMeta(",
  );
  // close the captureMeta(...) call: the original `= {…}` becomes `= __captureMeta({…})`.
  // We wrap by appending after the meta object literal is assigned; simplest robust form
  // is to assign then capture on the next line instead of inline-wrapping:
  const safe = source.replace(/export\s+const\s+meta\s*=\s*/, "const meta = ");
  const body = `${safe}\n;globalThis.__captureMeta(meta);`;
  const wrapped = `(async () => {\n${body}\n})()`;
  const js = transformSync(wrapped, { loader: "ts", format: "esm" }).code;
  void captured; // (kept intentionally unused: documents the inline alternative)
  return js;
}

function makeBannedDate(): typeof Date {
  const RealDate = Date;
  const Banned = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) {
      throw new Error("SandboxViolation: argless new Date() is not allowed in a workflow");
    }
    // @ts-expect-error forwarding constructor args
    return new RealDate(...args);
  } as unknown as typeof Date;
  Banned.now = () => {
    throw new Error("SandboxViolation: Date.now() is not allowed in a workflow");
  };
  Banned.parse = RealDate.parse;
  Banned.UTC = RealDate.UTC;
  return Banned;
}

export async function runInSandbox(
  source: string,
  globals: Record<string, unknown>,
): Promise<SandboxResult> {
  const js = transformScript(source);
  let metaCaptured: SandboxResult["meta"] | undefined;

  const bannedMath = {
    ...Math,
    random: () => {
      throw new Error("SandboxViolation: Math.random() is not allowed in a workflow");
    },
  };

  const context = vm.createContext({
    ...globals,
    Math: bannedMath,
    Date: makeBannedDate(),
    __captureMeta: (m: SandboxResult["meta"]) => {
      metaCaptured = m;
    },
    Promise,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    console,
  });

  const script = new vm.Script(js, { filename: "workflow.js" });
  const returnValue = await script.runInContext(context);

  if (!metaCaptured) {
    throw new Error("SandboxViolation: workflow script must export `const meta`");
  }
  return { meta: metaCaptured, returnValue };
}
```

> Implementation note for the engineer: the `captured` variable in `transformScript`
> documents an inline-wrap alternative but is unused; the `safe` + trailing
> `__captureMeta(meta)` form is what runs. If oxlint flags the unused `void captured`
> line, delete both the `captured` declaration and the `void captured;` line — they
> are documentation only.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/sandbox.test.ts`
Expected: PASS (all three sandbox tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sandbox.ts packages/core/src/sandbox.test.ts
git commit -m "feat(core): node:vm sandbox with meta capture + banned non-determinism"
```

### Task 15: runtime — wire `agent`, `phase`, `log`, `budget`

**Files:**

- Create: `packages/core/src/runtime.ts`
- Test: `packages/core/src/runtime.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createRuntime } from "./runtime.js";
import { createScriptedRunner } from "./scripted-runner.js";
import { createJournal } from "./journal.js";
import { createSemaphore } from "./semaphore.js";
import type { WorkflowEvent } from "./events.js";

function harness(responses = {}, opts = {}) {
  const events: WorkflowEvent[] = [];
  let clock = 0;
  const rt = createRuntime({
    runner: createScriptedRunner(responses, opts),
    semaphore: createSemaphore(8),
    journal: createJournal(),
    maxAgents: 1000,
    budgetTotal: null,
    args: { topic: "vue" },
    cwd: "/tmp",
    runId: "r1",
    emit: (e) => events.push(e),
    now: () => clock++,
  });
  return { rt, events };
}

describe("runtime.agent", () => {
  it("returns the text when no schema is given and exposes args", async () => {
    const { rt } = harness({ agent: { text: "hello" } });
    expect(rt.args).toEqual({ topic: "vue" });
    const out = await rt.agent("say hi", { label: "agent" });
    expect(out).toBe("hello");
  });

  it("returns validated typed data when a schema is given", async () => {
    const { rt } = harness({ a: { data: { n: 7 } } });
    const out = await rt.agent("give n", { label: "a", schema: z.object({ n: z.number() }) });
    expect(out).toEqual({ n: 7 });
  });

  it("records spend against the budget", async () => {
    const { rt } = harness({ a: { text: "x", outputTokens: 25 } });
    await rt.agent("p", { label: "a" });
    expect(rt.budget.spent()).toBe(25);
  });

  it("emits queued/started/finished events for an agent", async () => {
    const { rt, events } = harness({ a: { text: "x" } });
    rt.phase("Search");
    await rt.agent("p", { label: "a" });
    const types = events.map((e) => e.type);
    expect(types).toEqual(["phase-started", "agent-queued", "agent-started", "agent-finished"]);
  });

  it("throws when the runner fails, so parallel can null it", async () => {
    const { rt } = harness({
      a: { fail: { kind: "AdapterSpawn", adapter: "scripted", cause: "boom" } },
    });
    await expect(rt.agent("p", { label: "a" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/core/src/runtime.test.ts`
Expected: FAIL — cannot find `./runtime.js`.

- [ ] **Step 3: Create `packages/core/src/runtime.ts`**

```ts
import { z } from "zod";
import { toJsonSchema, validate } from "@workflow/schema";
import { createBudget, type Budget } from "./budget.js";
import { WorkflowThrow, type WorkflowError } from "./errors.js";
import type { Semaphore } from "./semaphore.js";
import type { Journal } from "./journal.js";
import type { AgentRunner } from "./types.js";
import type { WorkflowEvent } from "./events.js";

export interface AgentOptions {
  readonly label?: string;
  readonly phase?: string;
  readonly schema?: z.ZodType;
  readonly model?: string;
  readonly agentType?: string;
  readonly adapter?: string;
  readonly isolation?: "worktree";
}

export interface RuntimeDeps {
  readonly runner: AgentRunner;
  readonly semaphore: Semaphore;
  readonly journal: Journal;
  readonly maxAgents: number;
  readonly budgetTotal: number | null;
  readonly args: unknown;
  readonly cwd: string;
  readonly runId: string;
  readonly emit: (event: WorkflowEvent) => void;
  readonly now: () => number;
}

export interface Runtime {
  readonly args: unknown;
  readonly budget: Budget;
  agent(prompt: string, opts?: AgentOptions): Promise<unknown>;
  parallel<T>(thunks: ReadonlyArray<() => Promise<T>>): Promise<Array<T | null>>;
  pipeline(
    items: readonly unknown[],
    ...stages: ReadonlyArray<(prev: unknown, item: unknown, index: number) => Promise<unknown>>
  ): Promise<Array<unknown | null>>;
  phase(title: string): void;
  log(message: string): void;
}

export function createRuntime(deps: RuntimeDeps): Runtime {
  const budget = createBudget(deps.budgetTotal);
  let currentPhase = "default";
  let seq = 0;
  let spawned = 0;

  const agent = async (prompt: string, opts: AgentOptions = {}): Promise<unknown> => {
    const mySeq = seq++;
    const phase = opts.phase ?? currentPhase;
    const label = opts.label ?? `agent-${mySeq}`;
    const key = `${mySeq}:${phase}:${label}`;

    deps.emit({ type: "agent-queued", key, label, phase, at: deps.now() });

    // Resume: journal hit returns cached result without spawning.
    const cached = deps.journal.lookup(mySeq);
    if (cached) {
      budget.record(cached.outputTokens);
      deps.emit({
        type: "agent-finished",
        key,
        usage: { inputTokens: 0, outputTokens: cached.outputTokens },
        cached: true,
        at: deps.now(),
      });
      return cached.data ?? cached.text;
    }

    // Budget gate (parity: further agent() calls throw once spent reaches total).
    if (deps.budgetTotal !== null && budget.remaining() <= 0) {
      const e: WorkflowError = {
        kind: "BudgetExhausted",
        spent: budget.spent(),
        total: deps.budgetTotal,
      };
      deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
      throw new WorkflowThrow(e);
    }

    // Agent cap.
    if (spawned >= deps.maxAgents) {
      const e: WorkflowError = { kind: "AgentCapExceeded", cap: deps.maxAgents };
      deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
      throw new WorkflowThrow(e);
    }

    let jsonSchema: Record<string, unknown> | undefined;
    if (opts.schema) {
      const converted = toJsonSchema(opts.schema);
      if (converted.isErr()) {
        const e: WorkflowError = {
          kind: "SchemaValidation",
          issues: [
            converted.error.kind === "Conversion" ? converted.error.cause : "conversion failed",
          ],
          attempts: 0,
        };
        deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
        throw new WorkflowThrow(e);
      }
      jsonSchema = converted.value;
    }

    const release = await deps.semaphore.acquire();
    spawned++;
    deps.emit({ type: "agent-started", key, at: deps.now() });
    try {
      const controller = new AbortController();
      const result = await deps.runner.run(
        {
          prompt,
          schema: jsonSchema,
          model: opts.model,
          agentType: opts.agentType,
          label,
          cwd: deps.cwd,
          signal: controller.signal,
        },
        { runId: deps.runId, seq: mySeq },
      );

      if (result.isErr()) {
        deps.emit({ type: "agent-failed", key, error: result.error, at: deps.now() });
        throw new WorkflowThrow(result.error);
      }

      const res = result.value;
      for (const tool of res.toolCalls)
        deps.emit({ type: "agent-tool", key, tool, at: deps.now() });

      let value: unknown = res.text;
      if (opts.schema) {
        const validated = validate(opts.schema, res.data);
        if (validated.isErr()) {
          const e: WorkflowError = {
            kind: "SchemaValidation",
            issues:
              validated.error.kind === "Validation"
                ? validated.error.issues
                : ["validation failed"],
            attempts: 1,
          };
          deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
          throw new WorkflowThrow(e);
        }
        value = validated.value;
      }

      budget.record(res.usage.outputTokens);
      deps.journal.record({
        seq: mySeq,
        key,
        text: res.text,
        data: res.data,
        outputTokens: res.usage.outputTokens,
      });
      deps.emit({ type: "agent-finished", key, usage: res.usage, cached: false, at: deps.now() });
      return value;
    } finally {
      release();
    }
  };

  const parallel = async <T>(thunks: ReadonlyArray<() => Promise<T>>): Promise<Array<T | null>> =>
    Promise.all(thunks.map((t) => t().catch(() => null)));

  const pipeline = async (
    items: readonly unknown[],
    ...stages: ReadonlyArray<(prev: unknown, item: unknown, index: number) => Promise<unknown>>
  ): Promise<Array<unknown | null>> =>
    Promise.all(
      items.map(async (item, index) => {
        let prev: unknown = item;
        try {
          for (const stage of stages) prev = await stage(prev, item, index);
          return prev;
        } catch {
          return null;
        }
      }),
    );

  const phase = (title: string): void => {
    currentPhase = title;
    deps.emit({ type: "phase-started", phase: title, at: deps.now() });
  };

  const log = (message: string): void => {
    deps.emit({ type: "log", message, at: deps.now() });
  };

  return { args: deps.args, budget, agent, parallel, pipeline, phase, log };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/runtime.test.ts`
Expected: PASS (all runtime.agent tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/runtime.ts packages/core/src/runtime.test.ts
git commit -m "feat(core): runtime primitives (agent/phase/log/budget) over runner+journal"
```

### Task 16: `parallel` barrier + failure→null

**Files:**

- Test: `packages/core/src/runtime.parallel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createRuntime } from "./runtime.js";
import { createScriptedRunner } from "./scripted-runner.js";
import { createJournal } from "./journal.js";
import { createSemaphore } from "./semaphore.js";

function rt(responses = {}, opts = {}) {
  return createRuntime({
    runner: createScriptedRunner(responses, opts),
    semaphore: createSemaphore(8),
    journal: createJournal(),
    maxAgents: 1000,
    budgetTotal: null,
    args: {},
    cwd: "/tmp",
    runId: "r",
    emit: () => {},
    now: () => 0,
  });
}

describe("parallel", () => {
  it("awaits all thunks (barrier) and returns results in order", async () => {
    const r = rt({ a: { text: "A" }, b: { text: "B" }, c: { text: "C" } });
    const out = await r.parallel([
      () => r.agent("p", { label: "a" }),
      () => r.agent("p", { label: "b" }),
      () => r.agent("p", { label: "c" }),
    ]);
    expect(out).toEqual(["A", "B", "C"]);
  });

  it("maps a failing thunk to null instead of rejecting the whole call", async () => {
    const r = rt({
      a: { text: "A" },
      b: { fail: { kind: "AdapterSpawn", adapter: "x", cause: "boom" } },
    });
    const out = await r.parallel([
      () => r.agent("p", { label: "a" }),
      () => r.agent("p", { label: "b" }),
    ]);
    expect(out).toEqual(["A", null]);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then passes**

Run: `pnpm vitest run packages/core/src/runtime.parallel.test.ts`
Expected: PASS immediately (behavior implemented in Task 15) — this task pins the contract with dedicated tests. If it fails, the bug is in Task 15's `parallel`; fix there.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/runtime.parallel.test.ts
git commit -m "test(core): pin parallel barrier + failure-to-null contract"
```

### Task 17: `pipeline` has no barrier between stages

**Files:**

- Test: `packages/core/src/runtime.pipeline.test.ts`

- [ ] **Step 1: Write the failing test** (proves item A reaches stage 2 before item B finishes stage 1)

```ts
import { describe, it, expect } from "vitest";
import { createRuntime } from "./runtime.js";
import { createScriptedRunner } from "./scripted-runner.js";
import { createJournal } from "./journal.js";
import { createSemaphore } from "./semaphore.js";

describe("pipeline", () => {
  it("runs stages per-item with no barrier (fast item finishes while slow item lags)", async () => {
    const order: string[] = [];
    const r = createRuntime({
      runner: createScriptedRunner({}),
      semaphore: createSemaphore(8),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r",
      emit: () => {},
      now: () => 0,
    });

    const stage1 = async (_prev: unknown, item: unknown) => {
      const delay = item === "slow" ? 30 : 1;
      await new Promise((res) => setTimeout(res, delay));
      order.push(`s1:${item}`);
      return item;
    };
    const stage2 = async (_prev: unknown, item: unknown) => {
      order.push(`s2:${item}`);
      return item;
    };

    await r.pipeline(["slow", "fast"], stage1, stage2);
    // The fast item must reach stage 2 before the slow item clears stage 1.
    expect(order.indexOf("s2:fast")).toBeLessThan(order.indexOf("s1:slow"));
  });

  it("drops a throwing item to null without killing the others", async () => {
    const r = createRuntime({
      runner: createScriptedRunner({}),
      semaphore: createSemaphore(8),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r",
      emit: () => {},
      now: () => 0,
    });
    const out = await r.pipeline([1, 2], async (_p, item) => {
      if (item === 1) throw new Error("nope");
      return item;
    });
    expect(out).toEqual([null, 2]);
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/runtime.pipeline.test.ts`
Expected: PASS (behavior from Task 15). If the no-barrier assertion fails, the `pipeline` impl batched stages — fix Task 15 so each item runs its own independent chain.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/runtime.pipeline.test.ts
git commit -m "test(core): pin pipeline no-barrier + item-failure isolation"
```

### Task 18: resume from journal (cached results, then live)

**Files:**

- Test: `packages/core/src/runtime.resume.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createRuntime } from "./runtime.js";
import { createScriptedRunner } from "./scripted-runner.js";
import { createJournal } from "./journal.js";
import { createSemaphore } from "./semaphore.js";

describe("resume", () => {
  it("returns journaled results without calling the runner, then runs the rest live", async () => {
    const journal = createJournal([
      { seq: 0, key: "0:default:a", text: "cachedA", data: undefined, outputTokens: 5 },
    ]);
    const runner = createScriptedRunner({ b: { text: "liveB" } });

    const r = createRuntime({
      runner,
      semaphore: createSemaphore(8),
      journal,
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r",
      emit: () => {},
      now: () => 0,
    });

    const a = await r.agent("p", { label: "a" }); // seq 0 -> cached
    const b = await r.agent("p", { label: "b" }); // seq 1 -> live

    expect(a).toBe("cachedA");
    expect(b).toBe("liveB");
    expect(runner.callCount()).toBe(1); // only the live one hit the runner
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/runtime.resume.test.ts`
Expected: PASS (resume implemented in Task 15). If `callCount` is 2, the journal lookup isn't short-circuiting before `acquire`/`run` — fix in Task 15.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/runtime.resume.test.ts
git commit -m "test(core): pin journal-based resume (cached then live)"
```

### Task 19: concurrency cap is enforced end-to-end

**Files:**

- Test: `packages/core/src/runtime.concurrency.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createRuntime } from "./runtime.js";
import { createScriptedRunner } from "./scripted-runner.js";
import { createJournal } from "./journal.js";
import { createSemaphore } from "./semaphore.js";

describe("concurrency cap", () => {
  it("never runs more agents than the semaphore limit at once", async () => {
    const runner = createScriptedRunner({}, { delayMs: 10 });
    const r = createRuntime({
      runner,
      semaphore: createSemaphore(3),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r",
      emit: () => {},
      now: () => 0,
    });

    let peak = 0;
    const sampler = setInterval(() => {
      peak = Math.max(peak, runner.inFlight());
    }, 1);

    await r.parallel(Array.from({ length: 12 }, (_, i) => () => r.agent("p", { label: `x${i}` })));
    clearInterval(sampler);

    expect(peak).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/runtime.concurrency.test.ts`
Expected: PASS — peak in-flight ≤ 3.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/runtime.concurrency.test.ts
git commit -m "test(core): verify global concurrency cap across parallel agents"
```

### Task 20: agent cap + budget exhaustion throw

**Files:**

- Test: `packages/core/src/runtime.limits.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createRuntime } from "./runtime.js";
import { createScriptedRunner } from "./scripted-runner.js";
import { createJournal } from "./journal.js";
import { createSemaphore } from "./semaphore.js";

function make(maxAgents: number, budgetTotal: number | null, responses = {}) {
  return createRuntime({
    runner: createScriptedRunner(responses),
    semaphore: createSemaphore(8),
    journal: createJournal(),
    maxAgents,
    budgetTotal,
    args: {},
    cwd: "/tmp",
    runId: "r",
    emit: () => {},
    now: () => 0,
  });
}

describe("limits", () => {
  it("throws AgentCapExceeded once the cap is reached", async () => {
    const r = make(1, null, { a: { text: "ok" }, b: { text: "ok" } });
    await r.agent("p", { label: "a" });
    await expect(r.agent("p", { label: "b" })).rejects.toThrow(/AgentCapExceeded/);
  });

  it("throws BudgetExhausted once spend reaches the total", async () => {
    const r = make(1000, 20, { a: { text: "x", outputTokens: 20 }, b: { text: "y" } });
    await r.agent("p", { label: "a" }); // spends 20, hits total
    await expect(r.agent("p", { label: "b" })).rejects.toThrow(/BudgetExhausted/);
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/runtime.limits.test.ts`
Expected: PASS (both limits enforced in Task 15).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/runtime.limits.test.ts
git commit -m "test(core): enforce agent cap + budget exhaustion"
```

### Task 21: nested `workflow()` sharing the same semaphore + budget

**Files:**

- Modify: `packages/core/src/runtime.ts`
- Test: `packages/core/src/runtime.nested.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createRuntime } from "./runtime.js";
import { createScriptedRunner } from "./scripted-runner.js";
import { createJournal } from "./journal.js";
import { createSemaphore } from "./semaphore.js";

describe("nested workflow()", () => {
  it("runs a child workflow that shares the parent budget, and rejects double-nesting", async () => {
    const runner = createScriptedRunner({ child: { text: "kid", outputTokens: 7 } });
    const r = createRuntime({
      runner,
      semaphore: createSemaphore(4),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: 100,
      args: {},
      cwd: "/tmp",
      runId: "r",
      emit: () => {},
      now: () => 0,
      resolveWorkflow: async (name) => {
        expect(name).toBe("kid-flow");
        return {
          meta: { name: "kid-flow", description: "", phases: [] },
          run: async (childRt) => {
            return childRt.agent("hi", { label: "child" });
          },
        };
      },
    });

    const out = await r.workflow("kid-flow");
    expect(out).toBe("kid");
    expect(r.budget.spent()).toBe(7); // child spend counted on shared budget

    // Double-nesting must throw: the child runtime's workflow() is disabled.
    const runner2 = createScriptedRunner({});
    const r2 = createRuntime({
      runner: runner2,
      semaphore: createSemaphore(4),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r2",
      emit: () => {},
      now: () => 0,
      resolveWorkflow: async () => ({
        meta: { name: "x", description: "", phases: [] },
        run: async (childRt) => childRt.workflow("again"),
      }),
    });
    await expect(r2.workflow("x")).rejects.toThrow(/one level/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/core/src/runtime.nested.test.ts`
Expected: FAIL — `r.workflow is not a function` / `resolveWorkflow` unknown.

- [ ] **Step 3: Extend `RuntimeDeps`, `Runtime`, and `createRuntime` in `packages/core/src/runtime.ts`**

Add to `RuntimeDeps` (after `now`):

```ts
  readonly resolveWorkflow?: (name: string, args?: unknown) => Promise<LoadedWorkflow>;
  /** Internal: set on child runtimes to forbid further nesting. */
  readonly nestingDisabled?: boolean;
```

Add these exported types near `AgentOptions`:

```ts
export interface LoadedWorkflow {
  readonly meta: {
    readonly name: string;
    readonly description: string;
    readonly phases?: readonly unknown[];
  };
  run(runtime: Runtime, args?: unknown): Promise<unknown>;
}
```

Add to the `Runtime` interface:

```ts
  workflow(name: string, args?: unknown): Promise<unknown>;
```

Implement `workflow` inside `createRuntime` (before the `return`), reusing the same
`budget`, `deps.semaphore`, and `deps.journal` for the child by sharing deps:

```ts
const workflow = async (name: string, childArgs?: unknown): Promise<unknown> => {
  if (deps.nestingDisabled) {
    throw new WorkflowThrow({
      kind: "AdapterSpawn",
      adapter: "workflow",
      cause: "workflow() nesting is one level only",
    });
  }
  if (!deps.resolveWorkflow) {
    throw new WorkflowThrow({
      kind: "AdapterSpawn",
      adapter: "workflow",
      cause: "no workflow resolver configured",
    });
  }
  const loaded = await deps.resolveWorkflow(name, childArgs);
  // Child shares semaphore + journal + budget by sharing the SAME runtime's
  // spend accounting: we build a child runtime that delegates agent() to this one.
  const childRuntime: Runtime = {
    args: childArgs,
    budget,
    agent,
    parallel,
    pipeline,
    phase,
    log,
    workflow: async () => {
      throw new WorkflowThrow({
        kind: "AdapterSpawn",
        adapter: "workflow",
        cause: "workflow() nesting is one level only",
      });
    },
  };
  return loaded.run(childRuntime, childArgs);
};
```

Then add `workflow` to the returned object:

```ts
return { args: deps.args, budget, agent, parallel, pipeline, phase, log, workflow };
```

> Note: the error uses the existing `AdapterSpawn` kind with a descriptive `cause`
> rather than introducing a new union member, keeping `WorkflowError` stable. The
> double-nesting guard throws with the literal substring "one level" the test asserts.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run packages/core/src/runtime.nested.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/runtime.ts packages/core/src/runtime.nested.test.ts
git commit -m "feat(core): nested workflow() sharing budget/semaphore with one-level guard"
```

### Task 22: public API surface (`index.ts`) + full build/lint/typecheck gate

**Files:**

- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import * as core from "./index.js";

describe("public API", () => {
  it("exports the primitives factory and the building blocks", () => {
    expect(typeof core.createRuntime).toBe("function");
    expect(typeof core.createScriptedRunner).toBe("function");
    expect(typeof core.createJournal).toBe("function");
    expect(typeof core.createSemaphore).toBe("function");
    expect(typeof core.createBudget).toBe("function");
    expect(typeof core.reduce).toBe("function");
    expect(typeof core.runInSandbox).toBe("function");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run packages/core/src/index.test.ts`
Expected: FAIL — exports undefined.

- [ ] **Step 3: Replace `packages/core/src/index.ts`**

```ts
export * from "./errors.js";
export * from "./types.js";
export * from "./events.js";
export { createBudget, type Budget } from "./budget.js";
export { createSemaphore, type Semaphore } from "./semaphore.js";
export { createJournal, type Journal, type JournalEntry } from "./journal.js";
export { runInSandbox, transformScript, type SandboxResult } from "./sandbox.js";
export {
  createRuntime,
  type Runtime,
  type RuntimeDeps,
  type AgentOptions,
  type LoadedWorkflow,
} from "./runtime.js";
export {
  createScriptedRunner,
  type ScriptedRunner,
  type ScriptedResponse,
} from "./scripted-runner.js";
```

- [ ] **Step 4: Run the full gate**

Run: `pnpm vitest run packages/core/src/index.test.ts`
Expected: PASS.

Run: `pnpm -r build`
Expected: both `@workflow/schema` and `@workflow/core` build to `dist/` with `.d.ts`.

Run: `pnpm test`
Expected: all unit/integration tests across both packages PASS.

Run: `pnpm lint`
Expected: 0 errors (fix any oxlint findings, e.g. the documentation-only `void captured` line from Task 14).

Run: `pnpm -r typecheck`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/index.test.ts
git commit -m "feat(core): public API surface + green build/lint/typecheck"
```

---

## Self-Review (completed against the spec)

**Spec coverage (Plan 1 portion):**

- Monorepo / pnpm / turbo / tsup / strict TS → Tasks 1, 4, 7.
- oxlint + FP/immutability rules → Task 2 (enforced at Task 22 gate).
- Vitest projects, e2e excluded by default → Task 3.
- Zod → JSON Schema + validate (errors-as-Result) → Tasks 5–6.
- `WorkflowError` discriminated union + neverthrow → Task 8.
- budget (`total/spent/remaining`, null→Infinity) → Task 9; exhaustion throw → Task 20.
- concurrency semaphore (`min(16, cores−2)` enforced by injected limit) → Tasks 10, 19.
- event types + pure reducer (UI state source) → Task 11.
- `AgentRunner` contract + capability flags → Task 12.
- journal + seq keying + JSONL round-trip → Task 13; resume → Task 18.
- `node:vm` sandbox + banned `Date.now`/`Math.random`/argless `new Date()` → Task 14.
- primitives `agent/parallel/pipeline/phase/log` with parity boundary (value/throw, null-on-fail) → Tasks 15–17.
- 1000-agent cap → Task 20.
- nested `workflow()` sharing semaphore/budget, one-level guard → Task 21.
- public API + green gate → Task 22.

**Deferred to later plans (correctly out of Plan 1 scope):**

- Real harness adapters (codex/copilot/claude/raw-api), structured-output coercion + validate/**retry loop**, worktree isolation → **Plan 2**.
- fs-backed run directory (`journal.jsonl`/`events.jsonl`/`script.snapshot`), `script.snapshot` mismatch → `JournalCorrupt` → **Plan 2/4** (Task 13 keeps the in-memory journal + JSONL shape ready for it).
- Ink columns UI, keybindings → **Plan 3**.
- CLI (`run/watch/list/resume/stop/save/adapters`), consent, config, bundled workflows, `WORKFLOW_E2E` smoke suite → **Plan 4**.

**Placeholder scan:** no TBD/TODO; every code step contains complete code. The one
intentionally-unused construct (`void captured` in Task 14) is documented with
explicit removal instructions.

**Type consistency:** `WorkflowError` kinds, `AgentRequest`/`AgentResult`,
`JournalEntry` (`seq/key/text/data/outputTokens`), `WorkflowEvent` variants,
`RuntimeDeps` fields, and the `Runtime` method set (`agent/parallel/pipeline/phase/
log/workflow` + `args/budget`) are referenced identically across Tasks 11–22.

---

## Next plans (to be written after Plan 1 is green)

- **Plan 2 — `@workflow/adapters`:** `AgentRunner` impls for codex (`exec --json --output-schema -o --full-auto`), copilot (`-p --output-format json --allow-all-tools --no-ask-user`), claude (`-p --output-format stream-json`), raw-api; the validate/**retry** loop; capability-based coercion; JSONL parsers with recorded golden fixtures (`WORKFLOW_RECORD=1`); worktree isolation; fs-backed run directory + `JournalCorrupt` on `script.snapshot` mismatch.
- **Plan 3 — `@workflow/ui`:** Ink Miller-columns view rendering the event stream; keybindings (`↑↓ ←→ esc j/k p x r s`); `ink-testing-library` frame + keypress tests; TTY-less line-log fallback.
- **Plan 4 — `@workflow/cli`:** `workflow` bin (run/watch/list/resume/stop/save/adapters), detached spawning + run registry, consent prompt + permission modes, config files, bundled `deep-research` + `vue-newsletter`, opt-in `pnpm test:e2e` real-money smoke suite.
