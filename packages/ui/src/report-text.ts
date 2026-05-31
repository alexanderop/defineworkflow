import type { AgentReport, PhaseReport, RunReport } from "@workflow/core";
import { formatDuration } from "./format.js";

export interface RenderReportOptions {
  /** Cap the agent table; the rest collapse into a "+N more" line. */
  readonly maxAgents?: number;
}

const DASH = "—";

/** Token count, one decimal in k/M, trailing `.0` dropped: 140000→"140k", 184200→"184.2k". */
function tok(n: number): string {
  if (n < 1000) return String(n);
  const [value, suffix] = n < 1_000_000 ? [n / 1000, "k"] : [n / 1_000_000, "M"];
  return `${value.toFixed(1).replace(/\.0$/, "")}${suffix}`;
}

/** A numeric cell: em-dash for zero, otherwise the formatted token count. */
function tokCell(n: number): string {
  return n === 0 ? DASH : tok(n);
}

function countCell(n: number): string {
  return n === 0 ? DASH : String(n);
}

function timeCell(ms: number | undefined): string {
  return ms === undefined ? DASH : formatDuration(ms);
}

/** Compact model id for a table column: `claude-opus-4-8[1m]` → `opus-4-8`. */
function shortModel(model: string | undefined): string {
  if (!model) return DASH;
  return model.replace(/^claude-/, "").replace(/\[\d+m\]$/i, "");
}

type Align = "l" | "r";

/** Fixed-width text table with a rule under the header; columns padded per alignment. */
function table(
  headers: readonly string[],
  aligns: readonly Align[],
  rows: readonly (readonly string[])[],
): string[] {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const pad = (cell: string, i: number): string =>
    aligns[i] === "r" ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!);
  const line = (cells: readonly string[]): string => " " + cells.map(pad).join("  ").trimEnd();
  const rule =
    " " + "─".repeat(Math.max(0, widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 2));
  return [line(headers), rule, ...rows.map(line)];
}

function phaseRow(p: PhaseReport): readonly string[] {
  return [
    p.title,
    String(p.agents),
    tokCell(p.inputTokens),
    tokCell(p.outputTokens),
    countCell(p.toolCalls),
    timeCell(p.wallMs),
  ];
}

function agentRow(a: AgentReport): readonly string[] {
  const label =
    a.status === "cached"
      ? `${a.label} (cached)`
      : a.status === "failed"
        ? `${a.label} (failed)`
        : a.label;
  if (a.status === "cached") return [label, a.phase, DASH, DASH, DASH, DASH, DASH];
  return [
    label,
    a.phase,
    shortModel(a.model),
    tokCell(a.inputTokens),
    tokCell(a.outputTokens),
    countCell(a.toolCalls),
    timeCell(a.wallMs),
  ];
}

/**
 * Render a run report as a plain-text terminal summary: a run header, token/agent/tool/budget
 * lines, a per-phase table and a per-agent table (largest token spend first, capped by
 * `maxAgents` with a "+N more" tail). Used both for the non-TTY line-log fallback and the
 * auto-printed summary at the end of a foreground run.
 */
export function renderReportText(report: RunReport, opts: RenderReportOptions = {}): string {
  const maxAgents = opts.maxAgents ?? 20;
  const approx = report.totals.approximate ? "~" : "";
  const lines: string[] = [];

  const wall = report.wallMs !== undefined ? ` · ${formatDuration(report.wallMs)}` : "";
  lines.push(`Run  ${report.name} · ${report.status}${wall}`);
  lines.push("");

  const { inputTokens, outputTokens } = report.totals;
  lines.push(
    `Tokens   in ${approx}${tok(inputTokens)} · out ${approx}${tok(outputTokens)} · total ${approx}${tok(inputTokens + outputTokens)}`,
  );
  lines.push(
    `Agents   ${report.totals.agents}  (${report.totals.cached} cached, ${report.totals.failed} failed)`,
  );
  lines.push(`Tools    ${report.totals.toolCalls} calls`);
  if (report.budget)
    lines.push(
      `Budget   spent ${tok(report.budget.spent)} / ${tok(report.budget.total)}  (${report.budget.pct}%)`,
    );

  if (report.phases.length > 0) {
    lines.push("");
    lines.push(
      ...table(
        ["Phase", "agents", "in", "out", "tools", "time"],
        ["l", "r", "r", "r", "r", "r"],
        report.phases.map(phaseRow),
      ),
    );
  }

  if (report.agents.length > 0) {
    const ranked = report.agents
      .slice()
      .sort((x, y) => y.inputTokens + y.outputTokens - (x.inputTokens + x.outputTokens));
    const shown = ranked.slice(0, maxAgents);
    lines.push("");
    lines.push(
      ...table(
        ["Agent", "phase", "model", "in", "out", "tools", "time"],
        ["l", "l", "l", "r", "r", "r", "r"],
        shown.map(agentRow),
      ),
    );
    const hidden = ranked.length - shown.length;
    if (hidden > 0) lines.push(` +${hidden} more`);
  }

  return lines.join("\n");
}
