import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import type { RunReport as RunReportData } from "@workflow/core";
import { RunReport } from "./RunReport.js";

const report: RunReportData = {
  runId: "r1",
  name: "refactor-imports",
  status: "finished",
  wallMs: 134_000,
  totals: { agents: 3, cached: 1, failed: 0, inputTokens: 43_000, outputTokens: 10_200, toolCalls: 13, approximate: false },
  budget: { total: 500_000, spent: 10_200, pct: 2 },
  phases: [{ title: "Transform", agents: 2, inputTokens: 43_000, outputTokens: 10_200, toolCalls: 13, wallMs: 100_000 }],
  agents: [
    { label: "review:auth.ts", phase: "Transform", model: "claude-opus-4-8[1m]", status: "done", inputTokens: 21_000, outputTokens: 6_200, toolCalls: 4, wallMs: 14_000 },
    { label: "review:db.ts", phase: "Transform", status: "cached", inputTokens: 0, outputTokens: 0, toolCalls: 0 },
  ],
};

describe("RunReport", () => {
  it("renders the run name, status, summary, phase and agent rows", () => {
    const { lastFrame } = render(<RunReport report={report} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("refactor-imports");
    expect(frame).toContain("finished");
    expect(frame).toContain("total 53.2k");
    expect(frame).toContain("Budget");
    expect(frame).toContain("Transform");
    expect(frame).toContain("review:auth.ts");
    expect(frame).toContain("review:db.ts");
    expect(frame).toContain("cached");
  });
});
