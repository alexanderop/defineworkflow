import { z } from "zod";
import type { Immutable } from "@workflow/core";

export interface AdapterOverride {
  readonly bin?: string;
  readonly extraArgs?: readonly string[];
  readonly model?: string;
}

export interface WorkflowConfig {
  readonly concurrency?: number;
  readonly maxAgents?: number;
  readonly budget?: number | null;
  readonly disableWorkflows?: boolean;
  readonly adapters?: Readonly<Record<string, AdapterOverride>>;
  /** project path → workflow name → consented */
  readonly consents?: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
}

export interface ConfigDeps {
  readonly readFile: (path: string) => string | undefined;
  readonly homeDir: string;
  readonly cwd: string;
  readonly cores: number;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * The persisted config.json shape, validated at the disk boundary so the returned `WorkflowConfig`
 * is *earned* by `safeParse` rather than asserted blind. The lone remaining cast only narrows zod's
 * `T | undefined` optionals to our `exactOptionalPropertyTypes` interface — a no-op at runtime.
 */
const adapterOverrideSchema = z.object({
  bin: z.string().optional(),
  extraArgs: z.array(z.string()).optional(),
  model: z.string().optional(),
});
const workflowConfigSchema = z.object({
  concurrency: z.number().optional(),
  maxAgents: z.number().optional(),
  budget: z.number().nullable().optional(),
  disableWorkflows: z.boolean().optional(),
  adapters: z.record(z.string(), adapterOverrideSchema).optional(),
  consents: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
});

/** Parse + validate a config.json payload. Absent, malformed, or non-conforming input → `{}`. */
export function parseConfig(raw: string | undefined): WorkflowConfig {
  if (raw === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const result = workflowConfigSchema.safeParse(parsed);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- validated shape; narrows zod's `T | undefined` optionals to our exactOptional interface
  return result.success ? (result.data as WorkflowConfig) : {};
}

function mergeConsents(
  base: WorkflowConfig["consents"],
  over: WorkflowConfig["consents"],
): WorkflowConfig["consents"] {
  if (!base && !over) return undefined;
  const out: Record<string, Record<string, boolean>> = {};
  for (const [project, names] of Object.entries(base ?? {})) out[project] = { ...names };
  for (const [project, names] of Object.entries(over ?? {}))
    out[project] = { ...out[project], ...names };
  return out;
}

export function configPaths(deps: ConfigDeps): { personal: string; project: string } {
  return {
    personal: `${deps.homeDir}/.workflow/config.json`,
    project: `${deps.cwd}/.workflow/config.json`,
  };
}

/** Personal config is the base; project config shallow-overrides it (project wins). */
export function loadConfig(deps: ConfigDeps): Immutable<WorkflowConfig> {
  const { personal, project } = configPaths(deps);
  const base = parseConfig(deps.readFile(personal));
  const over = parseConfig(deps.readFile(project));
  const consents = mergeConsents(base.consents, over.consents);
  return {
    ...base,
    ...over,
    ...(consents ? { consents } : {}),
    disableWorkflows:
      base.disableWorkflows || over.disableWorkflows || deps.env["WORKFLOW_DISABLE"] === "1",
  };
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function concurrencyCap(cores: number): number {
  return Math.max(1, Math.min(16, cores - 2));
}

export function effectiveConcurrency(cfg: WorkflowConfig, cores: number): number {
  const cap = concurrencyCap(cores);
  return clamp(cfg.concurrency ?? cap, 1, cap);
}

export function effectiveMaxAgents(cfg: WorkflowConfig): number {
  return clamp(cfg.maxAgents ?? 1000, 1, 1000);
}
