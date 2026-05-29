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
/** Auto-detect preference order (raw-api is always available as the fallback). */
const PREFERENCE: readonly AdapterId[] = ["claude", "codex", "copilot", "raw-api"];

const asAdapterId = (s: string | undefined): AdapterId | undefined =>
  s !== undefined && (KNOWN as readonly string[]).includes(s) ? (s as AdapterId) : undefined;

export interface SelectAdapterArgs {
  readonly metaDefault?: string | undefined;
  readonly cliFlag?: string | undefined;
  readonly configDefault?: AdapterId | undefined;
  readonly detected: readonly AdapterId[];
}

/** Precedence (design §6): meta.defaultAdapter → CLI --adapter → config.defaultAdapter → auto-detect. */
export function selectAdapterId(args: SelectAdapterArgs): AdapterId {
  const explicit = asAdapterId(args.metaDefault) ?? asAdapterId(args.cliFlag) ?? asAdapterId(args.configDefault);
  if (explicit) return explicit;
  for (const id of PREFERENCE) {
    if (id === "raw-api" || args.detected.includes(id)) return id;
  }
  return "raw-api";
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
