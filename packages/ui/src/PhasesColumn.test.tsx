import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import type { PhaseState } from "@workflow/core";
import { PhasesColumn } from "./PhasesColumn.js";

const phases: PhaseState[] = [
  { title: "Scope", total: 1, done: 1, running: 0, tokens: 10, inputTokens: 6, outputTokens: 4 },
  { title: "Search", total: 5, done: 3, running: 1, tokens: 200, inputTokens: 140, outputTokens: 60 },
];

describe("PhasesColumn", () => {
  it("renders the Phases header and each phase with done/total counts", () => {
    const { lastFrame } = render(<PhasesColumn phases={phases} selectedIndex={0} focused frame={0} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Phases");
    expect(frame).toContain("Scope 1/1");
    expect(frame).toContain("Search 3/5");
    expect(frame).toContain("› ✓ Scope 1/1");
  });
});
