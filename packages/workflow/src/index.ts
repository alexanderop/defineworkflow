import { z } from "zod";
import type { AgentOptions, Budget, Immutable, JsonValue, Profile, ProfileConfig, Runtime, WorkflowMeta } from "@workflow/core";

export type {
  AgentOptions,
  AskUserQuestionOptions,
  HarnessId,
  JsonSchema,
  LoadedWorkflow,
  Profile,
  ProfileConfig,
  Runtime,
  WorkflowMeta,
} from "@workflow/core";

/** The engine's zod instance. Use it for `agent({ schema: z.object({ … }) })` to get inferred, type-safe output. */
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

export interface WorkflowContext {
  readonly agent: Runtime["agent"];
  readonly parallel: Runtime["parallel"];
  readonly pipeline: Runtime["pipeline"];
  readonly workflow: Runtime["workflow"];
  readonly phase: Runtime["phase"];
  readonly log: Runtime["log"];
  readonly askUserQuestion: Runtime["askUserQuestion"];
  readonly args: Runtime["args"];
  readonly budget: Budget;
}

export type WorkflowDefinition<T = unknown> = WorkflowMeta & {
  run(context: WorkflowContext): Promise<T> | T;
};

export function defineWorkflow<T>(definition: WorkflowDefinition<T>): WorkflowDefinition<T> {
  return definition;
}

function runtimeOnly(): never {
  throw new Error(
    "workflow primitives only run inside `workflow run`. Put this file through the workflow CLI instead of executing it directly.",
  );
}

/**
 * Invoke a coding agent. With a zod `schema`, the result is the schema's inferred output
 * type (validated at runtime); without one, the agent's raw text as `unknown`.
 * Authoring stub only — the CLI injects the live runtime at execution time.
 */
export function agent<T>(profile: Profile, prompt: string, opts: AgentOptions & { schema: z.ZodType<T> }): Promise<T>;
export function agent(profile: Profile, prompt: string, opts?: AgentOptions): Promise<unknown>;
export function agent<T>(prompt: string, opts: AgentOptions & { schema: z.ZodType<T> }): Promise<T>;
export function agent(prompt: string, opts?: AgentOptions): Promise<unknown>;
export function agent(_a: string | Profile, _b?: string | AgentOptions, _c?: AgentOptions): Promise<unknown> {
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

export const parallel: Runtime["parallel"] = runtimeOnly;
export const pipeline: Runtime["pipeline"] = runtimeOnly;
export const phase: Runtime["phase"] = runtimeOnly;
export const log: Runtime["log"] = runtimeOnly;
export const workflow: Runtime["workflow"] = runtimeOnly;

/**
 * Ask the human a question mid-run and await their answer. The question text is rendered as
 * markdown; pass `choices` for selectable options and `allowOther` for a free-text escape hatch.
 * The answer is journaled, so a resumed run returns it without re-asking. Authoring stub only —
 * the CLI injects the live runtime at execution time.
 */
export const askUserQuestion: Runtime["askUserQuestion"] = runtimeOnly;

export const args: Immutable<JsonValue> = null;
export const budget: Budget = {
  total: null,
  spent: runtimeOnly,
  remaining: runtimeOnly,
  record: runtimeOnly,
};
