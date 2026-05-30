import { describe, it, expect } from "vitest";
import { reduce, initialRunState, type WorkflowEvent } from "./events.js";

describe("event reducer", () => {
  it("accumulates phase counts and tokens from an event stream", () => {
    const events: WorkflowEvent[] = [
      { type: "run-started", runId: "r1", name: "demo", at: 0 },
      { type: "phase-started", phase: "Search", at: 1 },
      { type: "agent-queued", key: "0", label: "a", phase: "Search", at: 2 },
      { type: "agent-started", key: "0", at: 3 },
      { type: "agent-finished", key: "0", usage: { inputTokens: 5, outputTokens: 10 }, cached: false, at: 4 },
    ];
    const state = events.reduce(reduce, initialRunState());
    const phase = state.phases.get("Search")!;
    expect(phase.total).toBe(1);
    expect(phase.done).toBe(1);
    expect(state.totalTokens).toBe(15);
  });

  it("is pure — does not mutate the input state", () => {
    const s0 = initialRunState();
    reduce(s0, { type: "phase-started", phase: "X", at: 0 });
    expect(s0.phases.size).toBe(0);
  });

  it("stores the prompt from agent-queued on the agent state", () => {
    const events: WorkflowEvent[] = [
      { type: "agent-queued", key: "0", label: "a", phase: "Search", prompt: "Search the web for X", at: 0 },
    ];
    const state = events.reduce(reduce, initialRunState());
    expect(state.agents.get("0")?.prompt).toBe("Search the web for X");
  });

  it("accumulates agent-output chunks into resultText", () => {
    const events: WorkflowEvent[] = [
      { type: "agent-queued", key: "0", label: "a", phase: "P", at: 0 },
      { type: "agent-output", key: "0", chunk: "hello ", at: 1 },
      { type: "agent-output", key: "0", chunk: "world", at: 2 },
    ];
    const state = events.reduce(reduce, initialRunState());
    expect(state.agents.get("0")?.resultText).toBe("hello world");
  });

  it("records run + agent timestamps and model/liveTokens from progress", () => {
    const events: WorkflowEvent[] = [
      { type: "run-started", runId: "r", name: "demo", at: 100 },
      { type: "agent-queued", key: "0", label: "a", phase: "P", at: 110 },
      { type: "agent-started", key: "0", at: 120 },
      { type: "agent-progress", key: "0", tokens: 50, model: "claude-opus-4-8[1m]", at: 130 },
      { type: "agent-progress", key: "0", tokens: 200, at: 140 },
      { type: "agent-finished", key: "0", usage: { inputTokens: 1, outputTokens: 9 }, cached: false, model: "claude-opus-4-8[1m]", at: 160 },
    ];
    const state = events.reduce(reduce, initialRunState());
    const a = state.agents.get("0")!;
    expect(state.startedAt).toBe(100);
    expect(a.startedAt).toBe(120);
    expect(a.endedAt).toBe(160);
    expect(a.model).toBe("claude-opus-4-8[1m]");
    expect(a.liveTokens).toBe(200);
  });

  it("keeps liveTokens monotonic across out-of-order progress", () => {
    const events: WorkflowEvent[] = [
      { type: "agent-queued", key: "0", label: "a", phase: "P", at: 0 },
      { type: "agent-progress", key: "0", tokens: 300, at: 1 },
      { type: "agent-progress", key: "0", tokens: 100, at: 2 },
    ];
    const state = events.reduce(reduce, initialRunState());
    expect(state.agents.get("0")?.liveTokens).toBe(300);
  });

  it("sets endedAt on agent-failed", () => {
    const events: WorkflowEvent[] = [
      { type: "agent-queued", key: "0", label: "a", phase: "P", at: 0 },
      { type: "agent-started", key: "0", at: 1 },
      { type: "agent-failed", key: "0", error: { kind: "AdapterSpawn", adapter: "x", cause: "boom" }, at: 5 },
    ];
    const state = events.reduce(reduce, initialRunState());
    expect(state.agents.get("0")?.endedAt).toBe(5);
  });
});
