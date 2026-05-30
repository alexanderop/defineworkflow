// Browser-safe port of the engine's event → RunState reducer and the UI render
// helpers, plus a hand-authored "mock" event stream. This lets the docs replay the
// EXACT same RunState the Ink terminal UI renders from — without bundling
// @workflow/core (whose entry pulls in node:vm via the sandbox) or @workflow/ui
// (React/Ink). The reduce() and the format/selector helpers below are kept in lockstep
// with packages/core/src/events.ts and packages/ui/src/{format,selectors}.ts.
//
// The event stream is fabricated exactly like `defineworkflow run --mock`: schema-valid,
// deterministic, zero tokens, no real agents — only here the values are enriched with
// realistic tool calls / token counts / models so the UI shows its full richness.

// ─── Types (mirrors packages/core/src/events.ts) ──────────────────────────────────

export interface ToolEvent {
  readonly name: string;
  readonly input?: unknown;
}

export type WorkflowEvent =
  | { readonly type: "run-started"; readonly runId: string; readonly name: string; readonly at: number }
  | { readonly type: "phase-started"; readonly phase: string; readonly at: number }
  | { readonly type: "agent-queued"; readonly key: string; readonly label: string; readonly phase: string; readonly prompt?: string; readonly at: number }
  | { readonly type: "agent-started"; readonly key: string; readonly at: number }
  | { readonly type: "agent-tool"; readonly key: string; readonly tool: ToolEvent; readonly at: number }
  | { readonly type: "agent-progress"; readonly key: string; readonly tokens?: number; readonly model?: string; readonly at: number }
  | { readonly type: "agent-output"; readonly key: string; readonly chunk: string; readonly at: number }
  | { readonly type: "agent-finished"; readonly key: string; readonly usage: { inputTokens: number; outputTokens: number }; readonly cached: boolean; readonly model?: string; readonly at: number }
  | { readonly type: "log"; readonly message: string; readonly at: number }
  | { readonly type: "run-finished"; readonly runId: string; readonly at: number };

export type AgentStatus = "queued" | "running" | "done" | "failed";

export interface AgentState {
  key: string;
  label: string;
  phase: string;
  prompt: string;
  resultText: string;
  status: AgentStatus;
  tokens: number;
  cached: boolean;
  tools: ToolEvent[];
  startedAt?: number;
  endedAt?: number;
  model?: string;
  liveTokens?: number;
}

export interface PhaseState {
  title: string;
  total: number;
  done: number;
  running: number;
}

export interface RunState {
  runId: string;
  name: string;
  status: "pending" | "running" | "finished";
  phases: Map<string, PhaseState>;
  agents: Map<string, AgentState>;
  totalTokens: number;
  logs: string[];
  startedAt?: number;
  endedAt?: number;
}

export function initialRunState(): RunState {
  return { runId: "", name: "", status: "pending", phases: new Map(), agents: new Map(), totalTokens: 0, logs: [] };
}

function upsertPhase(phases: Map<string, PhaseState>, title: string, patch: (p: PhaseState) => PhaseState): Map<string, PhaseState> {
  const next = new Map(phases);
  const current = next.get(title) ?? { title, total: 0, done: 0, running: 0 };
  next.set(title, patch(current));
  return next;
}

// ─── reduce (mirrors packages/core/src/events.ts) ─────────────────────────────────

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
        cached: false,
        tools: [],
      });
      return { ...state, agents, phases: upsertPhase(state.phases, event.phase, (p) => ({ ...p, total: p.total + 1 })) };
    }
    case "agent-started": {
      const a = state.agents.get(event.key);
      if (!a) return state;
      const agents = new Map(state.agents);
      agents.set(event.key, { ...a, status: "running", startedAt: event.at });
      return { ...state, agents, phases: upsertPhase(state.phases, a.phase, (p) => ({ ...p, running: p.running + 1 })) };
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
        cached: event.cached,
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
        })),
      };
    }
    case "log":
      return { ...state, logs: [...state.logs, event.message] };
    case "run-finished":
      return { ...state, status: "finished", endedAt: event.at };
    default:
      return state;
  }
}

// ─── Render helpers (mirror packages/ui/src/{format,selectors}.ts) ────────────────

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function spinnerFrame(frame: number): string {
  return SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
}

export function statusGlyph(status: AgentStatus, frame = 0): string {
  switch (status) {
    case "done":
      return "✓";
    case "failed":
      return "✗";
    case "queued":
      return "▱";
    case "running":
      return spinnerFrame(frame);
  }
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  const rounded = k >= 100 ? Math.round(k) : Math.round(k * 10) / 10;
  return `${rounded}k`;
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const MODEL_TIERS: Readonly<Record<string, string>> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

export function formatModel(id: string): string {
  if (id === "") return "";
  const ctxMatch = /\[(\d+)m\]$/i.exec(id);
  const base = ctxMatch ? id.slice(0, ctxMatch.index) : id;
  const ctxNote = ctxMatch ? ` (${ctxMatch[1]!.toUpperCase()}M context)` : "";
  const m = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)$/.exec(base);
  if (!m) return id;
  return `${MODEL_TIERS[m[1]!]} ${m[2]}.${m[3]}${ctxNote}`;
}

export function orderedPhases(state: RunState): PhaseState[] {
  return [...state.phases.values()];
}

export function agentsInPhase(state: RunState, phase: string): AgentState[] {
  return [...state.agents.values()].filter((a) => a.phase === phase);
}

export function runElapsedMs(state: RunState, now: number): number {
  if (state.startedAt === undefined) return 0;
  const end = state.endedAt ?? now;
  return Math.max(0, end - state.startedAt);
}

export function agentElapsedMs(agent: AgentState, now: number): number {
  if (agent.startedAt === undefined) return 0;
  const end = agent.endedAt ?? now;
  return Math.max(0, end - agent.startedAt);
}

const MAX_TOOL_ARG = 38;

export function humanizeTool(tool: ToolEvent): string {
  if (tool.name === "StructuredOutput") return "StructuredOutput";
  const arg = firstArgPreview(tool.input);
  if (arg === "") return tool.name;
  const trimmed = arg.length > MAX_TOOL_ARG ? `${arg.slice(0, MAX_TOOL_ARG)}…` : arg;
  return `${tool.name}(${trimmed})`;
}

function firstArgPreview(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input === "string") return input.split("\n")[0]!.trim();
  if (typeof input === "number" || typeof input === "boolean") return String(input);
  if (Array.isArray(input)) return input.length > 0 ? firstArgPreview(input[0]) : "";
  if (typeof input === "object") {
    const first = Object.values(input as Record<string, unknown>)[0];
    return first === undefined ? "" : firstArgPreview(first);
  }
  return "";
}

export interface AgentRow {
  status: AgentStatus;
  label: string;
  model: string;
  tokens: string;
  toolCount: number;
  elapsed: string;
}

export function agentRow(agent: AgentState, now: number): AgentRow {
  const terminal = agent.status === "done" || agent.status === "failed";
  const toks = terminal ? agent.tokens : agent.liveTokens ?? 0;
  return {
    status: agent.status,
    label: agent.label,
    model: agent.model ? formatModel(agent.model) : "",
    tokens: toks > 0 ? formatTokens(toks) : "",
    toolCount: agent.tools.length,
    elapsed: agent.startedAt === undefined ? "" : formatDuration(agentElapsedMs(agent, now)),
  };
}

const STATUS_WORD: Readonly<Record<AgentStatus, string>> = {
  queued: "Queued",
  running: "Running",
  done: "Completed",
  failed: "Failed",
};

/** Flat detail lines for the selected agent — mirrors selectors.ts detailSections(). */
export function detailSections(agent: AgentState, now: number): string[] {
  const row = agentRow(agent, now);
  const lines: string[] = [];
  lines.push(row.model ? `${STATUS_WORD[agent.status]} · ${row.model}` : STATUS_WORD[agent.status]);
  const metrics = [row.tokens ? `${row.tokens} tok` : "", `${row.toolCount} tool call${row.toolCount === 1 ? "" : "s"}`, row.elapsed]
    .filter((s) => s !== "")
    .join(" · ");
  lines.push(metrics);
  lines.push("");

  const promptLines = agent.prompt.split("\n");
  lines.push(`Prompt · ${promptLines.length} line${promptLines.length === 1 ? "" : "s"}`);
  for (const l of promptLines.slice(0, 3)) lines.push(`  ${l}`);
  if (promptLines.length > 3) lines.push(`  … ${promptLines.length - 3} more lines`);
  lines.push("");

  const total = agent.tools.length;
  const shown = agent.tools.slice(Math.max(0, total - 3)).map(humanizeTool);
  lines.push(total === 0 ? "Activity · no tool calls" : `Activity · last ${shown.length} of ${total} tool calls`);
  for (const l of shown) lines.push(`  ${l}`);
  lines.push("");

  lines.push("Outcome");
  if (agent.resultText === "") lines.push("  (pending)");
  else for (const l of agent.resultText.split("\n")) lines.push(`  ${l}`);
  return lines;
}

export function totalDurationMs(events: readonly WorkflowEvent[]): number {
  if (events.length === 0) return 0;
  const first = events[0]!.at;
  const last = events[events.length - 1]!.at;
  return Math.max(0, last - first);
}
