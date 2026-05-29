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
  tokens: 44000,
  tools: [{ name: "WebSearch" }],
};

describe("DetailPane", () => {
  it("renders prompt, tool calls and result when an agent is selected", () => {
    const { lastFrame } = render(<DetailPane agent={agent} scroll={0} rows={20} focused />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("PROMPT");
    expect(frame).toContain("line P");
    expect(frame).toContain("• WebSearch");
    expect(frame).toContain("RESULT");
    expect(frame).toContain("R1");
  });

  it("scrolls: a positive scroll offset hides leading lines", () => {
    const { lastFrame } = render(<DetailPane agent={agent} scroll={8} rows={3} focused />);
    const frame = lastFrame() ?? "";
    // lines: [PROMPT, line P, "", TOOL CALLS, • WebSearch, "", RESULT, R1, R2, R3, R4]
    // scroll=8 → window starts at "R2"
    expect(frame).toContain("R2");
    expect(frame).not.toContain("PROMPT");
    expect(frame).not.toContain("R1");
  });

  it("shows a placeholder when no agent is selected", () => {
    const { lastFrame } = render(<DetailPane agent={undefined} scroll={0} rows={5} focused={false} />);
    expect(lastFrame() ?? "").toContain("no agent selected");
  });
});
