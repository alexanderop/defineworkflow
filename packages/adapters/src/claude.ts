import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import type { AgentRunner, AgentRequest, AgentResult, RunCtx, WorkflowError } from "@workflow/core";
import type { ProcessRunner } from "./process-runner.js";
import { createClaudeTranslator } from "./claude-stream.js";
import { CAPABILITIES } from "./detect.js";
import { runWithSchemaRetry } from "./coercion.js";
import { compileJsonSchemaValidator, extractJson } from "./json.js";

export interface ClaudeAdapterDeps {
  readonly processRunner: ProcessRunner;
  readonly bin?: string;
  readonly maxRetries?: number;
}

export function createClaudeAdapter(deps: ClaudeAdapterDeps): AgentRunner {
  const bin = deps.bin ?? "claude";
  const maxRetries = deps.maxRetries ?? 2;
  return {
    id: "claude",
    capabilities: CAPABILITIES.claude,
    run: async (req: AgentRequest, ctx: RunCtx): Promise<Result<AgentResult, WorkflowError>> => {
      let spawnError: WorkflowError | undefined;
      const validate = req.schema ? compileJsonSchemaValidator(req.schema) : undefined;

      let result: Awaited<ReturnType<typeof runWithSchemaRetry>>;
      try {
        result = await runWithSchemaRetry({
          validate,
          maxRetries,
          attempt: async (hint) => {
            const prompt = hint ? `${req.prompt}\n\n${hint}` : req.prompt;
            // Streaming JSON gives intermediate tool/token/model events for live progress.
            // YOLO mode: a headless `-p` agent can't answer permission prompts, and
            // `acceptEdits` blocks WebSearch/WebFetch — so skip all permission checks.
            const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--add-dir", req.cwd];
            if (req.schema) args.push("--json-schema", JSON.stringify(req.schema));
            if (req.model) args.push("--model", req.model);

            const translator = createClaudeTranslator();
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
              spawnError = { kind: "AdapterSpawn", adapter: "claude", cause: out.stderr || `exit ${out.code}` };
              throw new Error("claude spawn failed");
            }

            const final = translator.result();
            if (final.isError) {
              spawnError = { kind: "AdapterSpawn", adapter: "claude", cause: final.errorMessage ?? "claude reported is_error" };
              throw new Error("claude reported is_error");
            }

            // `structured_output` is the already-parsed object when --json-schema works.
            // Claude Code may still exit 0 with prose in `result`; treat that as a
            // validation miss so the schema retry loop can reprompt instead of surfacing
            // a misleading spawn failure.
            const data = req.schema ? (final.data ?? extractJson(final.text)) : final.data;
            return {
              text: final.text,
              data,
              usage: { inputTokens: final.usage.inputTokens, outputTokens: final.usage.outputTokens },
            };
          },
        });
      } catch (e) {
        if (spawnError) return err(spawnError);
        return err({ kind: "AdapterSpawn", adapter: "claude", cause: e instanceof Error ? e.message : String(e) });
      }
      if (spawnError) return err(spawnError);
      if (result.isErr()) return err(result.error);

      const r = result.value;
      return ok({
        text: r.text,
        ...(r.data !== undefined ? { data: r.data } : {}),
        usage: r.usage,
        toolCalls: [],
      });
    },
  };
}
