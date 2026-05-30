import { ok, err, type Result } from "neverthrow";
import { assertNever, type AgentRunner, type WorkflowError } from "@workflow/core";
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

const isAdapterId = (v: unknown): v is AdapterId =>
  typeof v === "string" && KNOWN.some((k) => k === v);

/**
 * The coding harness is declared in `meta.harness` and is the single source of
 * truth for the run default — there is no auto-detect or CLI/config override. A
 * workflow that does not declare a known harness fails fast with
 * `HarnessNotDeclared`. Per-call `agent("p", { adapter })` overrides are still
 * resolved separately via {@link buildRunnerMap}.
 */
export function resolveHarness(harness: unknown): Result<AdapterId, WorkflowError> {
  if (isAdapterId(harness)) {
    return ok(harness);
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
    default:
      return assertNever(id);
  }
}

export interface RunnerMap {
  readonly resolveRunner: (id: string) => AgentRunner | undefined;
  readonly ids: readonly AdapterId[];
}

/**
 * Build a per-call adapter map for design §6's per-call override: for each candidate
 * adapter (the detected harnesses plus the always-available raw-api fallback), build a
 * runner once and memoise it, skipping any that fail to build (e.g. raw-api without a key).
 * `resolveRunner(id)` returns the built runner or undefined (→ core falls back to the run default).
 */
export function buildRunnerMap(
  detected: readonly AdapterId[],
  cfg: WorkflowConfig,
  deps: BuildRunnerDeps,
): RunnerMap {
  const cache = new Map<AdapterId, AgentRunner>();
  const candidates: readonly AdapterId[] = [...new Set<AdapterId>([...detected, "raw-api"])];
  for (const id of candidates) {
    const result = buildRunner(id, cfg, deps);
    if (result.isOk()) cache.set(id, result.value);
  }
  return {
    resolveRunner: (id) => (isAdapterId(id) ? cache.get(id) : undefined),
    ids: [...cache.keys()],
  };
}
