import type { RunId } from "./brand.js";
import type { AgentState, RunState } from "./events.js";

export type RunReportStatus = "finished" | "running" | "failed";
export type AgentReportStatus = "done" | "failed" | "cached";

export interface RunReportTotals {
  /** Total agents queued. */
  readonly agents: number;
  /** Agents replayed from the journal (≈0 spend). */
  readonly cached: number;
  readonly failed: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly toolCalls: number;
  /** True when any agent's usage was reported as an estimate. */
  readonly approximate: boolean;
}

export interface RunBudgetReport {
  readonly total: number;
  readonly spent: number;
  readonly pct: number;
}

export interface PhaseReport {
  readonly title: string;
  readonly agents: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly toolCalls: number;
  /** Last endedAt − first startedAt within the phase, when both are known. */
  readonly wallMs?: number;
}

export interface AgentReport {
  readonly label: string;
  readonly phase: string;
  readonly model?: string;
  readonly status: AgentReportStatus;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly toolCalls: number;
  /** endedAt − startedAt, when both are known. */
  readonly wallMs?: number;
  /** startedAt − queuedAt: time spent waiting on the semaphore, when both are known. */
  readonly queuedMs?: number;
}

export interface RunReport {
  readonly runId: RunId;
  readonly name: string;
  readonly status: RunReportStatus;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly wallMs?: number;
  readonly totals: RunReportTotals;
  readonly budget?: RunBudgetReport;
  readonly phases: readonly PhaseReport[];
  readonly agents: readonly AgentReport[];
}

export interface SelectRunReportOptions {
  /** Override the derived run status — callers that know a run failed/aborted pass it here. */
  readonly status?: RunReportStatus;
}

function agentReportStatus(a: AgentState): AgentReportStatus {
  if (a.cached) return "cached";
  if (a.status === "failed") return "failed";
  return "done";
}

/** Span across a set of agents: max endedAt − min startedAt, or undefined when either bound is unknown. */
function spanMs(agents: readonly AgentState[]): number | undefined {
  let first: number | undefined;
  let last: number | undefined;
  for (const a of agents) {
    if (a.startedAt !== undefined) first = first === undefined ? a.startedAt : Math.min(first, a.startedAt);
    if (a.endedAt !== undefined) last = last === undefined ? a.endedAt : Math.max(last, a.endedAt);
  }
  if (first === undefined || last === undefined) return undefined;
  return Math.max(0, last - first);
}

/**
 * Pure projection of a run's `RunState` into a human-reportable summary. Cached (journal-replayed)
 * agents are counted under `cached` and excluded from token rollups — their tokens are ≈0 / not a
 * fresh spend. `budget.spent` uses the run's faithful output total (which does include replays, to
 * match how `budget.record` accrues). Phases that never queued an agent are dropped.
 */
export function selectRunReport(state: RunState, opts: SelectRunReportOptions = {}): RunReport {
  const agents = [...state.agents.values()];
  const status: RunReportStatus = opts.status ?? (state.status === "finished" ? "finished" : "running");

  const fresh = agents.filter((a) => !a.cached);
  const totals: RunReportTotals = {
    agents: agents.length,
    cached: agents.filter((a) => a.cached).length,
    failed: agents.filter((a) => a.status === "failed").length,
    inputTokens: fresh.reduce((n, a) => n + a.inputTokens, 0),
    outputTokens: fresh.reduce((n, a) => n + a.outputTokens, 0),
    toolCalls: agents.reduce((n, a) => n + a.tools.length, 0),
    approximate: agents.some((a) => a.approximate === true),
  };

  const phases: PhaseReport[] = [];
  for (const phase of state.phases.values()) {
    if (phase.total === 0) continue; // seeded-but-never-reached phase
    const inPhase = agents.filter((a) => a.phase === phase.title);
    const freshInPhase = inPhase.filter((a) => !a.cached);
    const phaseWall = spanMs(inPhase);
    phases.push({
      title: phase.title,
      agents: inPhase.length,
      inputTokens: freshInPhase.reduce((n, a) => n + a.inputTokens, 0),
      outputTokens: freshInPhase.reduce((n, a) => n + a.outputTokens, 0),
      toolCalls: inPhase.reduce((n, a) => n + a.tools.length, 0),
      ...(phaseWall !== undefined ? { wallMs: phaseWall } : {}),
    });
  }

  const agentReports: AgentReport[] = agents
    .slice()
    .sort((x, y) => (x.startedAt ?? Infinity) - (y.startedAt ?? Infinity))
    .map((a) => ({
      label: a.label,
      phase: a.phase,
      ...(a.model !== undefined ? { model: a.model } : {}),
      status: agentReportStatus(a),
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      toolCalls: a.tools.length,
      ...(a.startedAt !== undefined && a.endedAt !== undefined ? { wallMs: Math.max(0, a.endedAt - a.startedAt) } : {}),
      ...(a.startedAt !== undefined && a.queuedAt !== undefined ? { queuedMs: Math.max(0, a.startedAt - a.queuedAt) } : {}),
    }));

  const wallMs =
    state.startedAt !== undefined && state.endedAt !== undefined ? Math.max(0, state.endedAt - state.startedAt) : undefined;

  const budget: RunBudgetReport | undefined =
    typeof state.budgetTotal === "number"
      ? {
          total: state.budgetTotal,
          spent: state.totalOutputTokens,
          pct: state.budgetTotal > 0 ? Math.round((state.totalOutputTokens / state.budgetTotal) * 100) : 0,
        }
      : undefined;

  return {
    runId: state.runId,
    name: state.name,
    status,
    ...(state.startedAt !== undefined ? { startedAt: state.startedAt } : {}),
    ...(state.endedAt !== undefined ? { endedAt: state.endedAt } : {}),
    ...(wallMs !== undefined ? { wallMs } : {}),
    totals,
    ...(budget ? { budget } : {}),
    phases,
    agents: agentReports,
  };
}
