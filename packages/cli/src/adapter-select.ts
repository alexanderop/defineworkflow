import { ok, err, type Result } from "neverthrow";
import type { AgentRunner, WorkflowError } from "@workflow/core";
import {
  createClaudeAdapter,
  createCodexAdapter,
  createCopilotAdapter,
  createRawApiAdapter,
  type AdapterId,
  type ProcessRunner,
  type RawApiAdapterDeps,
} from "@workflow/adapters";
import type { WorkflowConfig } from "./config.js";

const KNOWN: readonly AdapterId[] = ["claude", "codex", "copilot", "raw-api"];

/**
 * The coding harness is declared in `meta.harness` and is the single source of
 * truth — there is no auto-detect or CLI/config override. A workflow that does
 * not declare a known harness fails fast with `HarnessNotDeclared`.
 */
export function resolveHarness(harness: unknown): Result<AdapterId, WorkflowError> {
  if (typeof harness === "string" && (KNOWN as readonly string[]).includes(harness)) {
    return ok(harness as AdapterId);
  }
  return err({ kind: "HarnessNotDeclared", found: typeof harness === "string" ? harness : undefined });
}

export interface BuildRunnerDeps {
  readonly processRunner: ProcessRunner;
  readonly complete?: RawApiAdapterDeps["complete"] | undefined;
}

export function buildRunner(id: AdapterId, cfg: WorkflowConfig, deps: BuildRunnerDeps): Result<AgentRunner, WorkflowError> {
  const bin = cfg.adapters?.[id]?.bin;
  const binDep = bin ? { bin } : {};
  switch (id) {
    case "claude":
      return ok(createClaudeAdapter({ processRunner: deps.processRunner, ...binDep }));
    case "codex":
      return ok(createCodexAdapter({ processRunner: deps.processRunner, ...binDep }));
    case "copilot":
      return ok(createCopilotAdapter({ processRunner: deps.processRunner, ...binDep }));
    case "raw-api":
      if (!deps.complete) {
        return err({ kind: "AdapterSpawn", adapter: "raw-api", cause: "no completion function configured (set ANTHROPIC_API_KEY or pick a CLI adapter)" });
      }
      return ok(createRawApiAdapter({ complete: deps.complete }));
  }
}
