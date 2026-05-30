import type { Result } from "neverthrow";
import type { RunId } from "./brand.js";
import type { WorkflowError } from "./errors.js";
import type { AgentProgress, AgentUsage, ToolEvent } from "./events.js";

export type JsonSchema = Record<string, unknown>;

/** The coding harness a workflow runs on. Declared in `meta.harness` (required). */
export type HarnessId = "claude" | "codex" | "copilot" | "raw-api";

/** A workflow's static metadata, declared via `export const meta = { … }`. */
export interface WorkflowMeta {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly harness: HarnessId;
  readonly phases?: readonly unknown[];
  /**
   * Where to persist this workflow's artifacts. When set, the run's return value is
   * written there (`result.json` verbatim, plus each top-level string field as its own
   * file). When omitted, the return value is only printed to the terminal. Relative
   * paths resolve against the run's cwd.
   */
  readonly output?: string;
}

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
  readonly runId: RunId;
  readonly seq: number;
  /** Live progress sink. Streaming adapters call this per tool/token/model update; others skip it. */
  readonly onProgress?: (p: AgentProgress) => void;
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
