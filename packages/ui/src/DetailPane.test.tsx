import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import type { AgentState } from "@workflow/core";
import { DetailPane } from "./DetailPane.js";

const agent: AgentState = {
  key: "k0",
  label: "angle-0",
  phase: "Search",
  prompt: "line P",
  resultText: "R1\nR2\nR3\nR4",
  status: "running",
  tokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cached: false,
  liveTokens: 44000,
  startedAt: 0,
  tools: [{ name: "WebSearch", input: { query: "vue 2026" } }],
};

describe("DetailPane", () => {
  it("renders Status / Metrics / Prompt / Activity / Outcome sections", () => {
    const { lastFrame } = render(<DetailPane agent={agent} scroll={0} rows={20} focused now={30000} expanded={false} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Running");
    expect(frame).toContain("44k tok");
    expect(frame).toContain("Prompt · 1 line");
    expect(frame).toContain("Activity · last 1 of 1 tool calls");
    expect(frame).toContain("WebSearch(vue 2026)");
    expect(frame).toContain("Outcome");
    expect(frame).toContain("R1");
  });

  it("shows a scroll indicator and windows the lines when content overflows", () => {
    const { lastFrame } = render(<DetailPane agent={agent} scroll={0} rows={4} focused now={0} expanded={false} />);
    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/1–3 of \d+ ↓/);
  });

  it("truncates long lines so the pane never grows past its row budget", () => {
    const longAgent: AgentState = { ...agent, prompt: "x".repeat(400), resultText: "y".repeat(400) };
    const rows = 4;
    const { lastFrame } = render(<DetailPane agent={longAgent} scroll={0} rows={rows} focused now={0} expanded={false} />);
    const rowCount = (lastFrame() ?? "").split("\n").length;
    expect(rowCount).toBeLessThanOrEqual(rows + 2);
  });

  it("shows a placeholder when no agent is selected", () => {
    const { lastFrame } = render(<DetailPane agent={undefined} scroll={0} rows={5} focused={false} now={0} expanded={false} />);
    expect(lastFrame() ?? "").toContain("no agent selected");
  });
});
