import type {
  RunState,
  AgentState,
  PhaseState,
  ToolEvent,
  AgentStatus,
  WorkflowEvent,
} from "@workflow/core";
import { formatError } from "@workflow/core";
import { formatTokens, formatDuration, formatModel } from "./format.js";

export function orderedPhases(state: RunState): readonly PhaseState[] {
  return [...state.phases.values()];
}

export function agentsInPhase(state: RunState, phase: string): readonly AgentState[] {
  return [...state.agents.values()].filter((a) => a.phase === phase);
}

/** Run elapsed ms: live (now − startedAt) while running, frozen at run-finished after. */
export function runElapsedMs(state: RunState, now: number): number {
  if (state.startedAt === undefined) return 0;
  const end = state.endedAt ?? now;
  return Math.max(0, end - state.startedAt);
}

/** Ms an agent has been (or was) running: live while running, frozen once ended. */
export function agentElapsedMs(agent: AgentState, now: number): number {
  if (agent.startedAt === undefined) return 0;
  const end = agent.endedAt ?? now;
  return Math.max(0, end - agent.startedAt);
}

const MAX_TOOL_ARG = 38;

/** Humanize a tool call: `Name(firstArgPreview…)`, bare name when arg-less, special-cased schema return. */
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
    const first: unknown = Object.values(input)[0];
    return first === undefined ? "" : firstArgPreview(first);
  }
  return "";
}

export interface ActivityDigest {
  readonly shown: readonly string[];
  readonly total: number;
}

/** The last `k` tool calls, humanized, plus the total count ("last 3 of 6"). */
export function activityDigest(agent: AgentState, k = 3): ActivityDigest {
  const total = agent.tools.length;
  const shown = agent.tools.slice(Math.max(0, total - k)).map(humanizeTool);
  return { shown, total };
}

/** First `headLines` of a prompt + `… N more lines`, or the whole prompt when expanded. */
export function promptPreview(prompt: string, expanded: boolean, headLines = 2): readonly string[] {
  const lines = prompt.split("\n");
  if (expanded || lines.length <= headLines) return lines;
  const remaining = lines.length - headLines;
  return [...lines.slice(0, headLines), `… ${remaining} more line${remaining === 1 ? "" : "s"}`];
}

export interface AgentRow {
  readonly status: AgentStatus;
  readonly label: string;
  readonly model: string;
  readonly tokens: string;
  readonly toolCount: number;
  readonly elapsed: string;
}

/** Glanceable per-agent row data: model · tokens · tool count · elapsed (live or frozen). */
export function agentRow(agent: AgentState, now: number): AgentRow {
  const terminal = agent.status === "done" || agent.status === "failed";
  const toks = terminal ? agent.tokens : (agent.liveTokens ?? 0);
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

/** Flat, scrollable detail lines: Status, Metrics, Prompt, Activity, Outcome. */
export function detailSections(
  agent: AgentState,
  now: number,
  expanded: boolean,
): readonly string[] {
  const row = agentRow(agent, now);
  const lines: string[] = [];

  const statusLine = row.model
    ? `${STATUS_WORD[agent.status]} · ${row.model}`
    : STATUS_WORD[agent.status];
  lines.push(statusLine);
  const metrics = [
    row.tokens ? `${row.tokens} tok` : "",
    `${row.toolCount} tool call${row.toolCount === 1 ? "" : "s"}`,
    row.elapsed,
  ]
    .filter((s) => s !== "")
    .join(" · ");
  lines.push(metrics);
  lines.push("");

  if (agent.status === "failed" && agent.error) {
    lines.push("Error");
    for (const l of formatError(agent.error).split("\n")) lines.push(`  ${l}`);
    lines.push("");
  }

  const promptLines = agent.prompt.split("\n");
  lines.push(
    `Prompt · ${promptLines.length} line${promptLines.length === 1 ? "" : "s"} · ⏎ ${expanded ? "collapse" : "expand"}`,
  );
  for (const l of promptPreview(agent.prompt, expanded)) lines.push(`  ${l}`);
  lines.push("");

  const digest = activityDigest(agent);
  lines.push(
    digest.total === 0
      ? "Activity · no tool calls"
      : `Activity · last ${digest.shown.length} of ${digest.total} tool calls`,
  );
  for (const l of digest.shown) lines.push(`  ${l}`);
  lines.push("");

  lines.push("Outcome");
  if (agent.resultText === "") lines.push("  (pending)");
  else for (const l of agent.resultText.split("\n")) lines.push(`  ${l}`);

  return lines;
}

export function elapsedMs(events: readonly WorkflowEvent[]): number {
  if (events.length === 0) return 0;
  const start = events[0]?.at ?? 0;
  const end = events[events.length - 1]?.at ?? start;
  return Math.max(0, end - start);
}
