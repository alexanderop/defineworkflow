import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import type { AgentRunner, AgentRequest, AgentResult, RunCtx } from "./types.js";
import type { WorkflowError } from "./errors.js";

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
