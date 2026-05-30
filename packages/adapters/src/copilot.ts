import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import type { AgentRunner, AgentRequest, AgentResult, RunCtx, WorkflowError } from "@workflow/core";
import type { ProcessRunner } from "./process-runner.js";
import { runWithSchemaRetry } from "./coercion.js";
import { extractJson, compileJsonSchemaValidator } from "./json.js";
import { createCopilotTranslator } from "./copilot-stream.js";
import { CAPABILITIES } from "./detect.js";

export interface CopilotAdapterDeps {
  readonly processRunner: ProcessRunner;
  readonly maxRetries?: number;
  readonly bin?: string;
}

export function createCopilotAdapter(deps: CopilotAdapterDeps): AgentRunner {
  const bin = deps.bin ?? "copilot";
  const maxRetries = deps.maxRetries ?? 2;
  return {
    id: "copilot",
    capabilities: CAPABILITIES.copilot,
    run: async (req: AgentRequest, ctx: RunCtx): Promise<Result<AgentResult, WorkflowError>> => {
      let spawnError: WorkflowError | undefined;
      const validate = req.schema ? compileJsonSchemaValidator(req.schema) : undefined;

      let result: Awaited<ReturnType<typeof runWithSchemaRetry>>;
      try {
        result = await runWithSchemaRetry({
          validate,
          maxRetries,
          attempt: async (hint) => {
            const schemaInstr = req.schema
              ? `\n\nRespond with ONLY a JSON value matching this JSON Schema:\n${JSON.stringify(req.schema)}`
              : "";
            const prompt = `${req.prompt}${schemaInstr}${hint ? `\n\n${hint}` : ""}`;
            // `--output-format json` streams session/tool/token events for live progress.
            const args = ["-p", prompt, "--output-format", "json", "--allow-all-tools", "--no-ask-user", "--silent", "-C", req.cwd];
            if (req.model) args.push("--model", req.model);
            // A fresh translator per attempt (retries re-run the agent from scratch).
            const translator = createCopilotTranslator();
            const out = await deps.processRunner.run({
              command: bin,
              args,
              cwd: req.cwd,
              signal: req.signal,
              onLine: (line) => {
                for (const p of translator.push(line)) ctx.onProgress?.(p);
              },
            });
            if (out.code !== 0) {
              spawnError = { kind: "AdapterSpawn", adapter: "copilot", cause: out.stderr || `exit ${out.code}` };
              throw new Error("copilot spawn failed");
            }
            const final = translator.result();
            // Fall back to raw stdout when the stream carried no `result` event, so a
            // valid answer that ended at turn_end is still extracted (old plain-text path).
            const text = final.text !== "" ? final.text : out.stdout;
            const data = req.schema ? extractJson(text) : undefined;
            return { text, data, usage: { inputTokens: final.usage.inputTokens, outputTokens: final.usage.outputTokens } };
          },
        });
      } catch (e) {
        if (spawnError) return err(spawnError);
        return err({ kind: "AdapterSpawn", adapter: "copilot", cause: e instanceof Error ? e.message : String(e) });
      }
      if (result.isErr()) return err(result.error);
      const r = result.value;
      // If the stream reported no usage, mark the length-based estimate approximate
      // rather than surfacing an unreliable exact zero.
      const usage =
        r.usage.outputTokens > 0
          ? r.usage
          : { inputTokens: 0, outputTokens: Math.ceil(r.text.length / 4), approximate: true };
      return ok({
        text: r.text,
        ...(r.data !== undefined ? { data: r.data } : {}),
        usage,
        toolCalls: [],
      });
    },
  };
}
