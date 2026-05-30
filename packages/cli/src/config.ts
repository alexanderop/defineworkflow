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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function readJson(deps: ConfigDeps, path: string): Record<string, unknown> {
  const raw = deps.readFile(path);
  if (raw === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mergeConsents(
  base: WorkflowConfig["consents"],
  over: WorkflowConfig["consents"],
): WorkflowConfig["consents"] {
  if (!base && !over) return undefined;
  const out: Record<string, Record<string, boolean>> = {};
  for (const [project, names] of Object.entries(base ?? {})) out[project] = { ...names };
  for (const [project, names] of Object.entries(over ?? {})) out[project] = { ...out[project], ...names };
  return out;
}

export function configPaths(deps: ConfigDeps): { personal: string; project: string } {
  return {
    personal: `${deps.homeDir}/.workflow/config.json`,
    project: `${deps.cwd}/.workflow/config.json`,
  };
}

/** Personal config is the base; project config shallow-overrides it (project wins). */
export function loadConfig(deps: ConfigDeps): WorkflowConfig {
  const { personal, project } = configPaths(deps);
  const base = readJson(deps, personal) as WorkflowConfig;
  const over = readJson(deps, project) as WorkflowConfig;
  const consents = mergeConsents(base.consents, over.consents);
  return {
    ...base,
    ...over,
    ...(consents ? { consents } : {}),
    disableWorkflows: base.disableWorkflows || over.disableWorkflows || deps.env["WORKFLOW_DISABLE"] === "1",
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
