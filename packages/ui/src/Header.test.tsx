import { describe, it, expect } from "vitest";
import type { RunId } from "@workflow/core";
import { render } from "ink-testing-library";
import { reduce, initialRunState, type WorkflowEvent } from "@workflow/core";
import { Header } from "./Header.js";

const make = (extra: WorkflowEvent[] = []) =>
  ([
    { type: "run-started", runId: "r1" as RunId, name: "deep-research", at: 0 },
    { type: "agent-queued", key: "k", label: "a", phase: "Search", at: 1 },
    ...extra,
  ] satisfies WorkflowEvent[]).reduce(reduce, initialRunState());

describe("Header", () => {
  it("shows name, agent counts, elapsed and adapter while running", () => {
    const state = make([{ type: "agent-finished", key: "k", usage: { inputTokens: 0, outputTokens: 1 }, cached: false, at: 2 }]);
    const { lastFrame } = render(<Header state={state} elapsedMs={161000} adapter="codex" />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("deep-research");
    expect(frame).toContain("1/1 agent");
    expect(frame).toContain("2m41s");
    expect(frame).toContain("codex");
    expect(frame).not.toContain("done"); // still running
    expect(frame).not.toContain("╭");
    expect(frame).not.toContain("╰");
  });

  it("shows `done` and an optional description for a finished run", () => {
    const state = make([
      { type: "agent-finished", key: "k", usage: { inputTokens: 0, outputTokens: 1 }, cached: false, at: 2 },
      { type: "run-finished", runId: "r1" as RunId, at: 3 },
    ]);
    const { lastFrame } = render(<Header state={state} elapsedMs={50000} description="Find posts from May 2026" />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("50s");
    expect(frame).toContain("done");
    expect(frame).toContain("Find posts from May 2026");
  });
});
