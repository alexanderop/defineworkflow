import { z } from "zod";
import type { AgentOptions, Budget, Runtime, WorkflowMeta } from "@workflow/core";

export type {
  AgentOptions,
  HarnessId,
  JsonSchema,
  LoadedWorkflow,
  Runtime,
  WorkflowMeta,
} from "@workflow/core";

/** The engine's zod instance. Use it for `agent({ schema: z.object({ … }) })` to get inferred, type-safe output. */
export { z };

export interface WorkflowContext {
  readonly agent: Runtime["agent"];
  readonly parallel: Runtime["parallel"];
  readonly pipeline: Runtime["pipeline"];
  readonly workflow: Runtime["workflow"];
  readonly phase: Runtime["phase"];
  readonly log: Runtime["log"];
  readonly args: unknown;
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
export function agent<T>(prompt: string, opts: AgentOptions & { schema: z.ZodType<T> }): Promise<T>;
export function agent(prompt: string, opts?: AgentOptions): Promise<unknown>;
export function agent(_prompt: string, _opts?: AgentOptions): Promise<unknown> {
  return runtimeOnly();
}

export const parallel: Runtime["parallel"] = runtimeOnly;
export const pipeline: Runtime["pipeline"] = runtimeOnly;
export const phase: Runtime["phase"] = runtimeOnly;
export const log: Runtime["log"] = runtimeOnly;
export const workflow: Runtime["workflow"] = runtimeOnly;

export const args: unknown = undefined;
export const budget: Budget = {
  total: null,
  spent: runtimeOnly,
  remaining: runtimeOnly,
  record: runtimeOnly,
};
