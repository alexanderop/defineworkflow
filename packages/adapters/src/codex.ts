import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import { writeFile, readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunner, AgentRequest, AgentResult, RunCtx, WorkflowError } from "@workflow/core";
import type { ProcessRunner } from "./process-runner.js";
import { createCodexTranslator } from "./codex-stream.js";
import { CAPABILITIES } from "./detect.js";

export interface FileStore {
  writeTemp(name: string, content: string): Promise<string>;
  read(path: string): Promise<string>;
  cleanup(paths: readonly string[]): Promise<void>;
}

export function createDefaultFileStore(): FileStore {
  return {
    writeTemp: async (name, content) => {
      const dir = await mkdtemp(join(tmpdir(), "wf-codex-"));
      const path = join(dir, name);
      await writeFile(path, content, "utf8");
      return path;
    },
    read: async (path) => readFile(path, "utf8"),
    cleanup: async (paths) => {
      for (const p of paths) await rm(p, { force: true }).catch(() => {});
    },
  };
}

export interface CodexAdapterDeps {
  readonly processRunner: ProcessRunner;
  readonly fileStore?: FileStore;
  readonly bin?: string;
}

export function createCodexAdapter(deps: CodexAdapterDeps): AgentRunner {
  const bin = deps.bin ?? "codex";
  const fileStore = deps.fileStore ?? createDefaultFileStore();
  return {
    id: "codex",
    capabilities: CAPABILITIES.codex,
    run: async (req: AgentRequest, ctx: RunCtx): Promise<Result<AgentResult, WorkflowError>> => {
      const created: string[] = [];
      // YOLO mode: `--full-auto` sandboxes execution (no network), which blocks
      // web research. Bypass approvals and the sandbox so headless agents get full
      // access. `--json` streams events for live progress + final extraction.
      const args = ["exec", "--json", "--skip-git-repo-check", "-C", req.cwd, "--dangerously-bypass-approvals-and-sandbox"];
      if (req.schema) {
        const schemaPath = await fileStore.writeTemp("codex-schema.json", JSON.stringify(req.schema));
        created.push(schemaPath);
        args.push("--output-schema", schemaPath);
      }
      if (req.model) args.push("-m", req.model);
      args.push(req.prompt);

      try {
        const translator = createCodexTranslator();
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
          return err({ kind: "AdapterSpawn", adapter: "codex", cause: out.stderr || `exit ${out.code}` });
        }
        const final = translator.result();
        const finalMessage = final.text.trim();
        let data: unknown;
        if (req.schema) {
          try {
            data = JSON.parse(finalMessage);
          } catch {
            return err({ kind: "AdapterSpawn", adapter: "codex", cause: "final message was not valid JSON for the schema" });
          }
        }
        // Real usage from turn.completed; fall back to a length estimate only when absent.
        const reportsTokens = final.usage.outputTokens > 0;
        const usage = reportsTokens
          ? { inputTokens: final.usage.inputTokens, outputTokens: final.usage.outputTokens }
          : { inputTokens: 0, outputTokens: Math.ceil(finalMessage.length / 4), approximate: true };
        return ok({
          text: finalMessage,
          ...(data !== undefined ? { data } : {}),
          usage,
          toolCalls: [],
        });
      } finally {
        await fileStore.cleanup(created);
      }
    },
  };
}
