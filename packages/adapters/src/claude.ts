import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import type { AgentRunner, AgentRequest, AgentResult, RunCtx, WorkflowError } from "@workflow/core";
import type { ProcessRunner } from "./process-runner.js";
import { createClaudeTranslator } from "./claude-stream.js";
import { CAPABILITIES } from "./detect.js";

export interface ClaudeAdapterDeps {
  readonly processRunner: ProcessRunner;
  readonly bin?: string;
}

export function createClaudeAdapter(deps: ClaudeAdapterDeps): AgentRunner {
  const bin = deps.bin ?? "claude";
  return {
    id: "claude",
    capabilities: CAPABILITIES.claude,
    run: async (req: AgentRequest, ctx: RunCtx): Promise<Result<AgentResult, WorkflowError>> => {
      // Streaming JSON gives intermediate tool/token/model events for live progress.
      // YOLO mode: a headless `-p` agent can't answer permission prompts, and
      // `acceptEdits` blocks WebSearch/WebFetch — so skip all permission checks.
      const args = ["-p", req.prompt, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--add-dir", req.cwd];
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
        return err({ kind: "AdapterSpawn", adapter: "claude", cause: out.stderr || `exit ${out.code}` });
      }

      const final = translator.result();
      if (final.isError) {
        return err({ kind: "AdapterSpawn", adapter: "claude", cause: final.errorMessage ?? "claude reported is_error" });
      }

      // `structured_output` is the already-parsed object when --json-schema is used;
      // otherwise fall back to parsing the result text as JSON for the requested schema.
      let data = final.data;
      if (req.schema && data === undefined) {
        if (final.text.trim() === "") {
          return err({ kind: "AdapterSpawn", adapter: "claude", cause: "schema requested but no structured_output or JSON result present" });
        }
        try {
          data = JSON.parse(final.text);
        } catch {
          return err({ kind: "AdapterSpawn", adapter: "claude", cause: "result was not valid JSON for the requested schema" });
        }
      }

      return ok({
        text: final.text,
        ...(data !== undefined ? { data } : {}),
        usage: { inputTokens: final.usage.inputTokens, outputTokens: final.usage.outputTokens },
        toolCalls: [],
      });
    },
  };
}
