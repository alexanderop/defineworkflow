import { describe, it, expect } from "vitest";
import type { RunReport } from "@workflow/core";
import { renderReportText } from "./report-text.js";

const base: RunReport = {
  runId: "r1",
  name: "refactor-imports",
  status: "finished",
  startedAt: 0,
  endedAt: 134_000,
  wallMs: 134_000,
  totals: { agents: 12, cached: 3, failed: 0, inputTokens: 184_200, outputTokens: 51_700, toolCalls: 47, approximate: false },
  budget: { total: 500_000, spent: 235_900, pct: 47 },
  phases: [
    { title: "Discover", agents: 3, inputTokens: 22_100, outputTokens: 4_000, toolCalls: 9, wallMs: 18_000 },
    { title: "Transform", agents: 8, inputTokens: 140_000, outputTokens: 42_300, toolCalls: 31, wallMs: 100_000 },
  ],
  agents: [
    { label: "review:auth.ts", phase: "Transform", model: "claude-opus-4-8[1m]", status: "done", inputTokens: 21_000, outputTokens: 6_200, toolCalls: 4, wallMs: 14_000, queuedMs: 200 },
    { label: "review:db.ts", phase: "Transform", status: "cached", inputTokens: 0, outputTokens: 0, toolCalls: 0 },
  ],
};

describe("renderReportText", () => {
  it("renders the run header with name, status and wall time", () => {
    const out = renderReportText(base);
    expect(out).toContain("refactor-imports");
    expect(out).toContain("finished");
    expect(out).toContain("2:14"); // 134s
  });

  it("renders token, agent and tool summary lines", () => {
    const out = renderReportText(base);
    expect(out).toMatch(/Tokens.*in 184\.2k.*out 51\.7k.*total 235\.9k/);
    expect(out).toMatch(/Agents.*12.*3 cached.*0 failed/);
    expect(out).toMatch(/Tools.*47/);
  });

  it("shows the budget line with spent / total and percent when a budget is set", () => {
    const out = renderReportText(base);
    expect(out).toMatch(/Budget.*235\.9k.*500k.*47%/);
  });

  it("omits the budget line when there is no budget", () => {
    const { budget: _budget, ...noBudget } = base;
    expect(renderReportText(noBudget as RunReport)).not.toContain("Budget");
  });

  it("lists each phase with its rollups", () => {
    const out = renderReportText(base);
    expect(out).toContain("Discover");
    expect(out).toContain("Transform");
    expect(out).toContain("140k"); // Transform input tokens
  });

  it("marks cached agent rows and renders em-dashes for their empty cells", () => {
    const out = renderReportText(base);
    const cachedLine = out.split("\n").find((l) => l.includes("review:db.ts"))!;
    expect(cachedLine).toContain("cached");
    expect(cachedLine).toContain("—");
  });

  it("annotates totals with ~ when usage is approximate", () => {
    const approx: RunReport = { ...base, totals: { ...base.totals, approximate: true } };
    expect(renderReportText(approx)).toContain("~");
  });

  it("truncates the agent table to the top N by tokens with a +N more line", () => {
    const many: RunReport = {
      ...base,
      agents: Array.from({ length: 25 }, (_, i) => ({
        label: `agent-${i}`,
        phase: "Transform",
        status: "done" as const,
        inputTokens: i * 1000,
        outputTokens: i * 100,
        toolCalls: 1,
      })),
    };
    const out = renderReportText(many, { maxAgents: 10 });
    expect(out).toContain("+15 more");
    // Highest-token agent kept, lowest dropped.
    expect(out).toContain("agent-24");
    expect(out).not.toMatch(/\bagent-0\b/);
  });
});
