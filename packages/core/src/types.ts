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
