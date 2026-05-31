import { z } from "zod";
import type {
  AgentOptions,
  Budget,
  Immutable,
  JsonValue,
  Profile,
  ProfileConfig,
  Runtime,
  WorkflowMeta,
} from "@workflow/core";

export type {
  /** Per-call options for {@link agent} — `label`, `phase`, `schema`, `model`, `instructions`, … */
  AgentOptions,
  /** Options for {@link askUserQuestion} — `question`, `choices`, `allowOther`, `default`, `key`. */
  AskUserQuestionOptions,
  /** The coding harness a workflow runs on: `"claude" | "codex" | "copilot" | "raw-api"`. */
  HarnessId,
  /** A plain JSON Schema object (the engine's internal/harness schema format). */
  JsonSchema,
  /** A workflow loaded from disk: its `meta` plus a `run(runtime, args)` entrypoint. */
  LoadedWorkflow,
  /** A reusable bundle of agent defaults, created with {@link profile}. */
  Profile,
  /** The fields a {@link profile} may set: `adapter`, `model`, `agentType`, `isolation`, `instructions`. */
  ProfileConfig,
  /** The live runtime surface injected into a workflow at execution time. */
  Runtime,
  /** A workflow's static metadata — the fields you pass to {@link defineWorkflow}. */
  WorkflowMeta,
} from "@workflow/core";

/**
 * The engine's own {@link https://zod.dev | zod} instance — use it (not a separately-installed
 * `zod`) so schemas line up with the version the runtime validates against.
 *
 * Pass a `z.object({ … })` to {@link agent} via `opts.schema` and the call resolves to the
 * schema's inferred output type, validated at runtime before it reaches your code.
 *
 * @example
 * ```ts
 * import { agent, z } from "defineworkflow";
 *
 * const { title, score } = await agent("Rate this PR", {
 *   schema: z.object({ title: z.string(), score: z.number().min(0).max(10) }),
 * });
 * // title: string, score: number — both validated
 * ```
 */
export { z };

// The sandbox injects `URL`/`URLSearchParams` as host globals (see @workflow/core's sandbox.ts).
// Declare them so a workflow file — which imports from `defineworkflow` and compiles with
// `types: []` — sees exactly the sandbox surface, without pulling in all of @types/node (which
// would falsely surface `process`/`fs`/`document`). `var` merges cleanly with @types/node's own
// global `URL` in this package's own typecheck, and `typeof import("node:url").URL` resolves even
// under `types: []`.
declare global {
  // oxlint-disable no-var
  var URL: typeof import("node:url").URL;
  var URLSearchParams: typeof import("node:url").URLSearchParams;
  // oxlint-enable no-var
}

/**
 * The live runtime handed to a workflow's {@link WorkflowDefinition.run | run()} method.
 *
 * Every field mirrors a top-level export of this package, so you can either destructure it
 * (`async run({ agent, parallel }) { … }`) or import the same primitives directly
 * (`import { agent, parallel } from "defineworkflow"`). Both resolve to the same injected
 * runtime at execution time.
 */
export interface WorkflowContext {
  /** Invoke a coding agent. See the {@link agent} export for overloads and examples. */
  readonly agent: Runtime["agent"];
  /** Run independent agent thunks concurrently. See the {@link parallel} export. */
  readonly parallel: Runtime["parallel"];
  /** Map items through sequential, type-inferred stages. See the {@link pipeline} export. */
  readonly pipeline: Runtime["pipeline"];
  /** Invoke a saved workflow by name as a nested child run. See the {@link workflow} export. */
  readonly workflow: Runtime["workflow"];
  /** Open a named phase for grouping subsequent agents in the UI. See the {@link phase} export. */
  readonly phase: Runtime["phase"];
  /** Emit a log line into the run's event stream. See the {@link log} export. */
  readonly log: Runtime["log"];
  /** Ask the human a question mid-run and await their answer. See the {@link askUserQuestion} export. */
  readonly askUserQuestion: Runtime["askUserQuestion"];
  /** The run's input arguments (from the CLI `--args`), deeply readonly. See the {@link args} export. */
  readonly args: Runtime["args"];
  /** The run's token budget gate and accounting. See the {@link budget} export. */
  readonly budget: Budget;
}

/**
 * The object you pass to {@link defineWorkflow}: a workflow's {@link WorkflowMeta | metadata}
 * (`name`, `description`, `harness`, …) plus an `async run(context)` that orchestrates the agents
 * and returns the workflow's result. The returned `T` is persisted to `meta.output` (when set)
 * and printed on completion.
 */
export type WorkflowDefinition<T = unknown> = WorkflowMeta & {
  run(context: WorkflowContext): Promise<T> | T;
};

/**
 * Define a workflow. This is the entrypoint of every `*.workflow.ts` file: export the result as
 * the module `default`, declare the static metadata, and put the orchestration logic in `run()`.
 *
 * The metadata is type-checked — `harness` only accepts `"claude" | "codex" | "copilot" |
 * "raw-api"`, so typos fail at compile time. At runtime the CLI strips the `defineworkflow`
 * import and injects the live runtime, calling `run()` with the {@link WorkflowContext}.
 *
 * The value `run()` returns becomes the workflow's result: it is always printed on completion,
 * and when `meta.output` is set it is persisted there (`result.json` verbatim, plus each
 * top-level string field as its own file).
 *
 * @example
 * ```ts
 * import { defineWorkflow, z } from "defineworkflow";
 *
 * export default defineWorkflow({
 *   name: "summarize",
 *   description: "Summarize a file into a title + bullet points",
 *   harness: "claude",
 *   output: "out/summary",
 *   async run({ agent, log }) {
 *     log("starting summary");
 *     const result = await agent("Summarize ./README.md", {
 *       schema: z.object({ title: z.string(), bullets: z.array(z.string()) }),
 *     });
 *     return result; // → out/summary/result.json (+ title.txt)
 *   },
 * });
 * ```
 *
 * @see Run it with `workflow run path/to/file.workflow.ts` (add `--mock` to iterate without
 * spawning real agents, `--args '{…}'` to pass input, `--yes` to skip the consent prompt).
 */
export function defineWorkflow<T>(definition: WorkflowDefinition<T>): WorkflowDefinition<T> {
  return definition;
}

function runtimeOnly(): never {
  throw new Error(
    "workflow primitives only run inside `workflow run`. Put this file through the workflow CLI instead of executing it directly.",
  );
}

/**
 * Invoke a coding agent with a prompt and await its result.
 *
 * With a zod `schema`, the call resolves to the schema's **inferred output type**, validated at
 * runtime (the runtime converts the schema to JSON Schema, retries/repairs malformed model output,
 * then parses it). Without a schema, the result is the agent's raw text as `unknown`.
 *
 * Pass a {@link Profile} (from {@link profile}) as the first argument to apply reusable defaults
 * (`model`, `instructions`, `adapter`, …); per-call `opts` override the profile.
 *
 * Each call is journaled by content-addressed key, so a resumed run returns the cached result instead
 * of re-invoking the model. Authoring stub only — the CLI injects the live runtime at execution time.
 *
 * @param profile - Optional reusable defaults bundle (see {@link profile}).
 * @param prompt - The instruction sent to the agent.
 * @param opts - Per-call options: `schema`, `label`, `phase`, `model`, `instructions`, …
 *
 * @example With a schema — typed, validated output:
 * ```ts
 * const { ok, notes } = await agent("Review the diff", {
 *   schema: z.object({ ok: z.boolean(), notes: z.array(z.string()) }),
 * });
 * ```
 *
 * @example Without a schema — raw text:
 * ```ts
 * const text = await agent("Write a haiku about TypeScript");
 * ```
 *
 * @example With a profile and a per-call label:
 * ```ts
 * const reviewer = profile({ model: "claude-opus-4-8", instructions: "You are a strict reviewer." });
 * await agent(reviewer, "Review src/index.ts", { label: "review", phase: "audit" });
 * ```
 */
export function agent<T>(
  profile: Profile,
  prompt: string,
  opts: AgentOptions & { schema: z.ZodType<T> },
): Promise<T>;
export function agent(profile: Profile, prompt: string, opts?: AgentOptions): Promise<unknown>;
export function agent<T>(prompt: string, opts: AgentOptions & { schema: z.ZodType<T> }): Promise<T>;
export function agent(prompt: string, opts?: AgentOptions): Promise<unknown>;
export function agent(
  _a: string | Profile,
  _b?: string | AgentOptions,
  _c?: AgentOptions,
): Promise<unknown> {
  return runtimeOnly();
}

/**
 * Bundle reusable agent defaults into a {@link Profile}, applied at a call site as
 * `agent(reviewer, prompt, opts)`. Pure: freezes a copy of `config`. Per-call fields
 * (`label`, `phase`, `schema`) are intentionally absent from {@link ProfileConfig}.
 *
 * This is a standalone re-implementation of the engine's `profile()` (the runner strips the
 * `workflow` import and injects the live one) — kept here so authoring works outside the
 * sandbox without bundling `@workflow/core`. The `__workflowProfile` brand must match core.
 */
export function profile(config: ProfileConfig): Profile {
  return { __workflowProfile: true, config: Object.freeze({ ...config }) };
}

/**
 * Run independent agent thunks **concurrently** and await all of them, preserving order. Each
 * thunk that rejects yields `null` in its slot (rather than failing the whole batch), so the
 * result is `Array<T | null>`. Concurrency is bounded by the run's agent semaphore.
 *
 * Authoring stub only — the CLI injects the live runtime at execution time.
 *
 * @example
 * ```ts
 * const [a, b] = await parallel([
 *   () => agent("Summarize file A", { schema: z.object({ s: z.string() }) }),
 *   () => agent("Summarize file B", { schema: z.object({ s: z.string() }) }),
 * ]);
 * ```
 */
export const parallel: Runtime["parallel"] = runtimeOnly;

/**
 * Map a list of `items` through a chain of **sequential stages**, applied per item. Each stage
 * receives `(prev, item, index)` where `prev` is the previous stage's output for that item — the
 * overloads (1–5 stages) infer each `prev` from the prior stage's return type, so no casts are
 * needed. A stage returning `null` short-circuits that item, yielding `Array<Last | null>`.
 *
 * Authoring stub only — the CLI injects the live runtime at execution time.
 *
 * @example
 * ```ts
 * const out = await pipeline(
 *   ["a.ts", "b.ts"],
 *   async (file) => agent(`Read ${file}`),                 // stage 1 → prev for stage 2
 *   async (text) => agent(`Refactor:\n${text}`),           // stage 2 receives stage 1's result
 * );
 * ```
 */
export const pipeline: Runtime["pipeline"] = runtimeOnly;

/**
 * Open a named **phase**, grouping the agents invoked after it under one heading in the terminal
 * UI and the saved run. Phases are purely organizational — they don't gate or branch execution.
 *
 * Authoring stub only — the CLI injects the live runtime at execution time.
 *
 * @example
 * ```ts
 * phase("planning");
 * await agent("Draft a plan");
 * phase("implementation");
 * await agent("Implement the plan");
 * ```
 */
export const phase: Runtime["phase"] = runtimeOnly;

/**
 * Emit a **log line** into the run's event stream. It surfaces in the live UI and the persisted
 * run log — use it to narrate progress. Does not consume budget or spawn an agent.
 *
 * Authoring stub only — the CLI injects the live runtime at execution time.
 *
 * @example
 * ```ts
 * log(`processing ${files.length} files`);
 * ```
 */
export const log: Runtime["log"] = runtimeOnly;

/**
 * Invoke a **saved workflow by name** as a nested child run. The child shares the parent's token
 * budget and returns its result here. Nesting is one level deep only — a workflow invoked this way
 * cannot itself call `workflow()`.
 *
 * Authoring stub only — the CLI injects the live runtime at execution time.
 *
 * @example
 * ```ts
 * const review = await workflow("code-review", { pr: 1234 });
 * ```
 */
export const workflow: Runtime["workflow"] = runtimeOnly;

/**
 * Ask the human a question mid-run and await their answer (deterministic human-in-the-loop). The
 * `question` text is rendered as markdown; pass `choices` for selectable options and `allowOther`
 * for a free-text escape hatch. Asking costs no tokens and isn't an agent.
 *
 * The answer is journaled, so a **resumed run returns it without re-asking**. In headless/CI runs
 * (no TTY, `--detach`) it resolves from the CLI `--answers` map keyed by `key`, then the question's
 * `default`, else fails fast rather than hanging.
 *
 * Authoring stub only — the CLI injects the live runtime at execution time.
 *
 * @example
 * ```ts
 * const choice = await askUserQuestion({
 *   key: "deploy-target",
 *   question: "Where should I **deploy**?",
 *   choices: ["staging", "production"],
 *   allowOther: true,
 *   default: "staging", // used in headless runs
 * });
 * ```
 */
export const askUserQuestion: Runtime["askUserQuestion"] = runtimeOnly;

/**
 * The run's **input arguments**, parsed from the CLI `--args '{…}'` flag (or a nested
 * {@link workflow} call's args). Deeply readonly ({@link JsonValue}), and `null` when none were
 * supplied. Narrow it yourself (or validate with {@link z}) before use.
 *
 * At authoring time this is the stub value `null`; the CLI injects the real arguments at runtime.
 *
 * @example
 * ```ts
 * const { pr } = args as { pr: number };
 * await agent(`Review PR #${pr}`);
 * ```
 */
export const args: Immutable<JsonValue> = null;

/**
 * The run's **token budget** gate and accounting. `total` is the cap (`null` when uncapped);
 * `spent()` returns output tokens used so far and `remaining()` how many are left (`Infinity` when
 * uncapped). The budget is a *soft* gate — under concurrency a run can slightly overshoot.
 *
 * The fields here are authoring stubs; the CLI injects the live budget at runtime.
 *
 * @example
 * ```ts
 * if (budget.remaining() < 1000) log("running low on budget");
 * ```
 */
export const budget: Budget = {
  total: null,
  spent: runtimeOnly,
  remaining: runtimeOnly,
  record: runtimeOnly,
};
