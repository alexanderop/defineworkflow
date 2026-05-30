import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import { writeFile, readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunner, AgentRequest, AgentResult, RunCtx, WorkflowError } from "@workflow/core";
import type { ProcessRunner } from "./process-runner.js";
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
    run: async (req: AgentRequest, _ctx: RunCtx): Promise<Result<AgentResult, WorkflowError>> => {
      const created: string[] = [];
      const outPath = await fileStore.writeTemp("codex-out.txt", "");
      created.push(outPath);
      // YOLO mode: `--full-auto` sandboxes execution (no network), which blocks
      // web research. Bypass approvals and the sandbox so headless agents get full
      // access — the workflow run is already gated by the CLI consent prompt.
      const args = ["exec", "--skip-git-repo-check", "-C", req.cwd, "--dangerously-bypass-approvals-and-sandbox", "-o", outPath];
      if (req.schema) {
        const schemaPath = await fileStore.writeTemp("codex-schema.json", JSON.stringify(req.schema));
        created.push(schemaPath);
        args.push("--output-schema", schemaPath);
      }
      if (req.model) args.push("-m", req.model);
      args.push(req.prompt);

      try {
        const out = await deps.processRunner.run({ command: bin, args, cwd: req.cwd, signal: req.signal });
        if (out.code !== 0) {
          return err({ kind: "AdapterSpawn", adapter: "codex", cause: out.stderr || `exit ${out.code}` });
        }
        const finalMessage = (await fileStore.read(outPath)).trim();
        let data: unknown;
        if (req.schema) {
          try {
            data = JSON.parse(finalMessage);
          } catch {
            return err({ kind: "AdapterSpawn", adapter: "codex", cause: "final message was not valid JSON for the schema" });
          }
        }
        const outputTokens = Math.ceil(finalMessage.length / 4);
        const result: AgentResult = {
          text: finalMessage,
          ...(data !== undefined ? { data } : {}),
          usage: { inputTokens: 0, outputTokens, approximate: true },
          toolCalls: [],
        };
        return ok(result);
      } finally {
        await fileStore.cleanup(created);
      }
    },
  };
}
