import type { WorkflowError } from "./errors.js";
import { assertNever } from "./exhaustive.js";

export interface ToolEvent {
  readonly name: string;
  readonly input?: unknown;
}

/** Harness-neutral progress sink payload: an adapter's StreamTranslator emits these. */
export interface AgentProgress {
  /** A tool call just observed. */
  readonly tool?: ToolEvent;
  /** Cumulative output tokens so far. */
  readonly tokens?: number;
  /** Raw model id, e.g. "claude-opus-4-8[1m]". */
  readonly model?: string;
}

export interface AgentUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly approximate?: boolean;
}

export type WorkflowEvent =
  | { readonly type: "run-started"; readonly runId: string; readonly name: string; readonly at: number }
  | { readonly type: "phase-started"; readonly phase: string; readonly at: number }
  | { readonly type: "agent-queued"; readonly key: string; readonly label: string; readonly phase: string; readonly prompt?: string; readonly at: number }
  | { readonly type: "agent-started"; readonly key: string; readonly at: number }
  | { readonly type: "agent-tool"; readonly key: string; readonly tool: ToolEvent; readonly at: number }
  | { readonly type: "agent-progress"; readonly key: string; readonly tokens?: number; readonly model?: string; readonly at: number }
  | { readonly type: "agent-output"; readonly key: string; readonly chunk: string; readonly at: number }
  | { readonly type: "agent-finished"; readonly key: string; readonly usage: AgentUsage; readonly cached: boolean; readonly model?: string; readonly at: number }
  | { readonly type: "agent-failed"; readonly key: string; readonly error: WorkflowError; readonly at: number }
  | { readonly type: "log"; readonly message: string; readonly at: number }
  | { readonly type: "run-finished"; readonly runId: string; readonly at: number };

export type AgentStatus = "queued" | "running" | "done" | "failed";

export interface AgentState {
  readonly key: string;
  readonly label: string;
  readonly phase: string;
  readonly prompt: string;
  readonly resultText: string;
  readonly status: AgentStatus;
  readonly tokens: number;
  readonly tools: readonly ToolEvent[];
  /** Wall-clock of agent-started (ms). */
  readonly startedAt?: number;
  /** Wall-clock of agent-finished/agent-failed (ms). */
  readonly endedAt?: number;
  /** Raw model id reported by the harness, e.g. "claude-opus-4-8[1m]". */
  readonly model?: string;
  /** Cumulative output tokens observed while running (monotonic). */
  readonly liveTokens?: number;
  /** Set when status is "failed" — the typed reason the agent failed. */
  readonly error?: WorkflowError;
}

export interface PhaseState {
  readonly title: string;
  readonly total: number;
  readonly done: number;
  readonly running: number;
  readonly tokens: number;
}

export interface RunState {
  readonly runId: string;
  readonly name: string;
  readonly status: "pending" | "running" | "finished";
  readonly phases: ReadonlyMap<string, PhaseState>;
  readonly agents: ReadonlyMap<string, AgentState>;
  readonly totalTokens: number;
  readonly logs: readonly string[];
  /** Wall-clock of run-started (ms); drives the header's run elapsed. */
  readonly startedAt?: number;
  /** Wall-clock of run-finished (ms); freezes elapsed for finished/replayed runs. */
  readonly endedAt?: number;
}

export function initialRunState(): RunState {
  return {
    runId: "",
    name: "",
    status: "pending",
    phases: new Map(),
    agents: new Map(),
    totalTokens: 0,
    logs: [],
  };
}

function upsertPhase(
  phases: ReadonlyMap<string, PhaseState>,
  title: string,
  patch: (p: PhaseState) => PhaseState,
): Map<string, PhaseState> {
  const next = new Map(phases);
  const current = next.get(title) ?? { title, total: 0, done: 0, running: 0, tokens: 0 };
  next.set(title, patch(current));
  return next;
}

export function reduce(state: RunState, event: WorkflowEvent): RunState {
  switch (event.type) {
    case "run-started":
      return { ...state, runId: event.runId, name: event.name, status: "running", startedAt: event.at };
    case "phase-started":
      return { ...state, phases: upsertPhase(state.phases, event.phase, (p) => p) };
    case "agent-queued": {
      const agents = new Map(state.agents);
      agents.set(event.key, {
        key: event.key,
        label: event.label,
        phase: event.phase,
        prompt: event.prompt ?? "",
        resultText: "",
        status: "queued",
        tokens: 0,
        tools: [],
      });
      return {
        ...state,
        agents,
        phases: upsertPhase(state.phases, event.phase, (p) => ({ ...p, total: p.total + 1 })),
      };
    }
    case "agent-started": {
      const a = state.agents.get(event.key);
      if (!a) return state;
      const agents = new Map(state.agents);
      agents.set(event.key, { ...a, status: "running", startedAt: event.at });
      return {
        ...state,
        agents,
        phases: upsertPhase(state.phases, a.phase, (p) => ({ ...p, running: p.running + 1 })),
      };
    }
    case "agent-tool": {
      const a = state.agents.get(event.key);
      if (!a) return state;
      const agents = new Map(state.agents);
      agents.set(event.key, { ...a, tools: [...a.tools, event.tool] });
      return { ...state, agents };
    }
    case "agent-progress": {
      const a = state.agents.get(event.key);
      if (!a) return state;
      const agents = new Map(state.agents);
      // Tokens are monotonic — never let a late/out-of-order update lower the count.
      const liveTokens = event.tokens !== undefined ? Math.max(a.liveTokens ?? 0, event.tokens) : a.liveTokens;
      agents.set(event.key, {
        ...a,
        ...(event.model !== undefined ? { model: event.model } : {}),
        ...(liveTokens !== undefined ? { liveTokens } : {}),
      });
      return { ...state, agents };
    }
    case "agent-output": {
      const a = state.agents.get(event.key);
      if (!a) return state;
      const agents = new Map(state.agents);
      agents.set(event.key, { ...a, resultText: a.resultText + event.chunk });
      return { ...state, agents };
    }
    case "agent-finished": {
      const a = state.agents.get(event.key);
      if (!a) return state;
      const tokens = event.usage.inputTokens + event.usage.outputTokens;
      const agents = new Map(state.agents);
      agents.set(event.key, {
        ...a,
        status: "done",
        tokens,
        endedAt: event.at,
        ...(event.model !== undefined ? { model: event.model } : {}),
      });
      return {
        ...state,
        agents,
        totalTokens: state.totalTokens + tokens,
        phases: upsertPhase(state.phases, a.phase, (p) => ({
          ...p,
          done: p.done + 1,
          running: Math.max(0, p.running - (event.cached ? 0 : 1)),
          tokens: p.tokens + tokens,
        })),
      };
    }
    case "agent-failed": {
      const a = state.agents.get(event.key);
      if (!a) return state;
      const agents = new Map(state.agents);
      agents.set(event.key, { ...a, status: "failed", error: event.error, endedAt: event.at });
      return {
        ...state,
        agents,
        phases: upsertPhase(state.phases, a.phase, (p) => ({ ...p, running: Math.max(0, p.running - 1) })),
      };
    }
    case "log":
      return { ...state, logs: [...state.logs, event.message] };
    case "run-finished":
      return { ...state, status: "finished", endedAt: event.at };
    default:
      return assertNever(event);
  }
}
