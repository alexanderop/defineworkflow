import { describe, it, expect } from "vitest";
import { createLineLogger } from "./line-log.js";

describe("createLineLogger", () => {
  it("renders one line for human-meaningful events", () => {
    const line = createLineLogger();
    expect(line({ type: "run-started", runId: "r1", name: "demo", at: 0 })).toBe("▶ demo (r1)");
    expect(line({ type: "phase-started", phase: "Search", at: 0 })).toBe("# Search");
    expect(line({ type: "agent-finished", key: "k0", usage: { inputTokens: 1, outputTokens: 9 }, cached: false, at: 0 })).toBe("  ✓ k0 (9 tok)");
    expect(line({ type: "agent-finished", key: "k0", usage: { inputTokens: 0, outputTokens: 9 }, cached: true, at: 0 })).toBe("  ✓ k0 (9 tok, cached)");
    expect(line({ type: "agent-failed", key: "k0", error: { kind: "BudgetExhausted", spent: 5, total: 5 }, at: 0 })).toBe("  ✗ k0: BudgetExhausted: spent 5 of 5");
    expect(line({ type: "agent-failed", key: "k1", error: { kind: "AdapterSpawn", adapter: "claude", cause: "exit 1: boom" }, at: 0 })).toBe("  ✗ k1: AdapterSpawn (claude): exit 1: boom");
    expect(line({ type: "log", message: "hi", at: 0 })).toBe("  hi");
    expect(line({ type: "run-finished", runId: "r1", at: 0 })).toBe("■ done");
  });

  it("renders a question and its answer", () => {
    const line = createLineLogger();
    expect(line({ type: "question-asked", key: "deploy-target", question: "## Where to deploy?\nPick one", at: 0 })).toBe(
      "? deploy-target: ## Where to deploy?",
    );
    expect(line({ type: "question-answered", key: "deploy-target", answer: "staging", cached: false, at: 0 })).toBe("  ↳ staging");
  });

  it("returns null for noisy events that don't warrant a line", () => {
    const line = createLineLogger();
    expect(line({ type: "agent-queued", key: "k0", label: "a", phase: "P", at: 0 })).toBeNull();
    expect(line({ type: "agent-output", key: "k0", chunk: "x", at: 0 })).toBeNull();
    expect(line({ type: "agent-tool", key: "k0", tool: { name: "WebSearch" }, at: 0 })).toBeNull();
    expect(line({ type: "agent-progress", key: "k0", tokens: 5, at: 0 })).toBeNull();
  });

  it("resolves the friendly label from agent-queued instead of the internal key", () => {
    const line = createLineLogger();
    const key = "0:Draft:draft:release";
    line({ type: "agent-queued", key, label: "draft:release", phase: "Draft", at: 0 });
    expect(line({ type: "agent-started", key, at: 0 })).toBe("  … draft:release");
    expect(line({ type: "agent-finished", key, usage: { inputTokens: 1, outputTokens: 721 }, cached: false, at: 0 })).toBe("  ✓ draft:release (721 tok)");
  });

  it("falls back to the key when no label was seen", () => {
    const line = createLineLogger();
    expect(line({ type: "agent-started", key: "k9", at: 0 })).toBe("  … k9");
  });

  it("prints a phase header only once even though phases are seeded then re-entered", () => {
    const line = createLineLogger();
    expect(line({ type: "phase-started", phase: "Draft", at: 0 })).toBe("# Draft");
    expect(line({ type: "phase-started", phase: "Write", at: 0 })).toBe("# Write");
    // runtime re-emits phase-started when phase() actually runs — must not double-print.
    expect(line({ type: "phase-started", phase: "Draft", at: 1 })).toBeNull();
    expect(line({ type: "phase-started", phase: "Write", at: 2 })).toBeNull();
  });

  it("appends elapsed seconds when the agent's start time is known", () => {
    const line = createLineLogger();
    const key = "0:P:writer";
    line({ type: "agent-queued", key, label: "writer", phase: "P", at: 0 });
    line({ type: "agent-started", key, at: 1000 });
    expect(line({ type: "agent-finished", key, usage: { inputTokens: 1, outputTokens: 50 }, cached: false, at: 4000 })).toBe("  ✓ writer (50 tok · 3s)");
  });
});
