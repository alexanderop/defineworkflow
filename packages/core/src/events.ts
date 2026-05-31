import type { RunId } from "./brand.js";
import type { WorkflowError } from "./errors.js";
import type { Immutable } from "./type-ext.js";
import { assertNever } from "./exhaustive.js";

// Each public type below is declared as a mutable `…Shape` base wrapped in `Immutable<…>`. The
// wrapper makes deep immutability structural: a `readonly` modifier can't be forgotten on a new
// field because the whole shape is frozen by the type. Construct/update these only through fresh
// object literals (mutable literals are assignable to `Immutable<…>` slots).

interface ToolEventShape {
  name: string;
  input?: unknown;
}
export type ToolEvent = Immutable<ToolEventShape>;

interface AgentProgressShape {
  /** A tool call just observed. */
  tool?: ToolEventShape;
  /** Cumulative output tokens so far. */
  tokens?: number;
  /** Raw model id, e.g. "claude-opus-4-8[1m]". */
  model?: string;
}
/** Harness-neutral progress sink payload: an adapter's StreamTranslator emits these. */
export type AgentProgress = Immutable<AgentProgressShape>;

interface AgentUsageShape {
  inputTokens: number;
  outputTokens: number;
  approximate?: boolean;
}
export type AgentUsage = Immutable<AgentUsageShape>;

type WorkflowEventShape =
  | { type: "run-started"; runId: RunId; name: string; budgetTotal?: number | null; at: number }
  | { type: "phase-started"; phase: string; at: number }
  | { type: "agent-queued"; key: string; label: string; phase: string; prompt?: string; overrides?: string[]; at: number }
  | { type: "agent-started"; key: string; at: number }
  | { type: "agent-tool"; key: string; tool: ToolEventShape; at: number }
  | { type: "agent-progress"; key: string; tokens?: number; model?: string; at: number }
  | { type: "agent-output"; key: string; chunk: string; at: number }
  | { type: "agent-finished"; key: string; usage: AgentUsageShape; cached: boolean; model?: string; at: number }
  | { type: "agent-failed"; key: string; error: WorkflowError; at: number }
  | { type: "question-asked"; key: string; question: string; choices?: string[]; allowOther?: boolean; at: number }
  | { type: "question-answered"; key: string; answer: string; cached: boolean; at: number }
  | { type: "log"; message: string; at: number }
  | { type: "run-finished"; runId: RunId; at: number };
export type WorkflowEvent = Immutable<WorkflowEventShape>;

export type AgentStatus = "queued" | "running" | "done" | "failed";

interface AgentStateShape {
  key: string;
  label: string;
  phase: string;
  prompt: string;
  resultText: string;
  status: AgentStatus;
  tokens: number;
  /** Input tokens reported at agent-finished (0 for cached replays). */
  inputTokens: number;
  /** Output tokens reported at agent-finished. */
  outputTokens: number;
  /** True when the result was replayed from the journal rather than freshly spawned. */
  cached: boolean;
  /** Set when the harness reported the usage figures as an estimate. */
  approximate?: boolean;
  tools: ToolEventShape[];
  /** Wall-clock of agent-queued (ms); with startedAt yields the time spent waiting on the semaphore. */
  queuedAt?: number;
  /** Wall-clock of agent-started (ms). */
  startedAt?: number;
  /** Wall-clock of agent-finished/agent-failed (ms). */
  endedAt?: number;
  /** Raw model id reported by the harness, e.g. "claude-opus-4-8[1m]". */
  model?: string;
  /** Cumulative output tokens observed while running (monotonic). */
  liveTokens?: number;
  /** Set when status is "failed" — the typed reason the agent failed. */
  error?: WorkflowError;
}
export type AgentState = Immutable<AgentStateShape>;

interface PhaseStateShape {
  title: string;
  total: number;
  done: number;
  running: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
}
export type PhaseState = Immutable<PhaseStateShape>;

interface PendingQuestionShape {
  key: string;
  question: string;
  choices?: string[];
  allowOther?: boolean;
}
/** An outstanding human-in-the-loop question awaiting the user's answer. */
export type PendingQuestion = Immutable<PendingQuestionShape>;

interface RunStateShape {
  runId: RunId;
  name: string;
  status: "pending" | "running" | "finished";
  phases: Map<string, PhaseStateShape>;
  agents: Map<string, AgentStateShape>;
  /** Set while a mid-run question awaits an answer; cleared when the matching answer arrives. */
  pendingQuestion?: PendingQuestionShape;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** The run's configured budget cap (output tokens), or null when unbounded; from run-started. */
  budgetTotal?: number | null;
  logs: string[];
  /** Wall-clock of run-started (ms); drives the header's run elapsed. */
  startedAt?: number;
  /** Wall-clock of run-finished (ms); freezes elapsed for finished/replayed runs. */
  endedAt?: number;
}
export type RunState = Immutable<RunStateShape>;

export function initialRunState(): RunState {
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- branded RunId sentinel; "" carries the RunId brand only at this trusted mint point
    runId: "" as RunId,
    name: "",
    status: "pending",
    phases: new Map(),
    agents: new Map(),
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    logs: [],
  };
}

function upsertPhase(
  phases: ReadonlyMap<string, PhaseState>,
  title: string,
  patch: (p: PhaseState) => PhaseState,
): Map<string, PhaseState> {
  const next = new Map(phases);
  const current = next.get(title) ?? { title, total: 0, done: 0, running: 0, tokens: 0, inputTokens: 0, outputTokens: 0 };
  next.set(title, patch(current));
  return next;
}

export function reduce(state: RunState, event: WorkflowEvent): RunState {
  switch (event.type) {
    case "run-started":
      return {
        ...state,
        runId: event.runId,
        name: event.name,
        status: "running",
        startedAt: event.at,
        ...(event.budgetTotal !== undefined ? { budgetTotal: event.budgetTotal } : {}),
      };
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
        inputTokens: 0,
        outputTokens: 0,
        cached: false,
        tools: [],
        queuedAt: event.at,
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
      const { inputTokens, outputTokens } = event.usage;
      const tokens = inputTokens + outputTokens;
      const agents = new Map(state.agents);
      agents.set(event.key, {
        ...a,
        status: "done",
        tokens,
        inputTokens,
        outputTokens,
        cached: event.cached,
        endedAt: event.at,
        ...(event.usage.approximate ? { approximate: true } : {}),
        ...(event.model !== undefined ? { model: event.model } : {}),
      });
      return {
        ...state,
        agents,
        totalTokens: state.totalTokens + tokens,
        totalInputTokens: state.totalInputTokens + inputTokens,
        totalOutputTokens: state.totalOutputTokens + outputTokens,
        phases: upsertPhase(state.phases, a.phase, (p) => ({
          ...p,
          done: p.done + 1,
          running: Math.max(0, p.running - (event.cached ? 0 : 1)),
          tokens: p.tokens + tokens,
          inputTokens: p.inputTokens + inputTokens,
          outputTokens: p.outputTokens + outputTokens,
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
    case "question-asked": {
      const pendingQuestion: PendingQuestion = {
        key: event.key,
        question: event.question,
        ...(event.choices ? { choices: event.choices } : {}),
        ...(event.allowOther !== undefined ? { allowOther: event.allowOther } : {}),
      };
      return { ...state, pendingQuestion };
    }
    case "question-answered": {
      // Only the matching question clears the pane; a stale/mismatched answer is ignored.
      if (state.pendingQuestion?.key !== event.key) return state;
      const { pendingQuestion: _cleared, ...rest } = state;
      return rest;
    }
    case "log":
      return { ...state, logs: [...state.logs, event.message] };
    case "run-finished":
      return { ...state, status: "finished", endedAt: event.at };
    default:
      return assertNever(event);
  }
}
