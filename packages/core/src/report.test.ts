import { describe, it, expect } from "vitest";
import type { RunId } from "./brand.js";
import { reduce, initialRunState, type WorkflowEvent } from "./events.js";
import { selectRunReport } from "./report.js";

const build = (events: WorkflowEvent[]) => events.reduce(reduce, initialRunState());

describe("selectRunReport", () => {
  it("rolls up totals, phases and agents from a finished run", () => {
    const state = build([
      {
        type: "run-started",
        runId: "r1" as RunId,
        name: "refactor-imports",
        budgetTotal: 500_000,
        at: 0,
      },
      { type: "phase-started", phase: "Discover", at: 0 },
      { type: "phase-started", phase: "Transform", at: 0 },
      // Discover: one agent
      { type: "agent-queued", key: "0:Discover:scan", label: "scan", phase: "Discover", at: 100 },
      { type: "agent-started", key: "0:Discover:scan", at: 200 },
      { type: "agent-tool", key: "0:Discover:scan", tool: { name: "Grep" }, at: 250 },
      {
        type: "agent-finished",
        key: "0:Discover:scan",
        usage: { inputTokens: 22_000, outputTokens: 4_000 },
        cached: false,
        model: "claude-opus-4-8[1m]",
        at: 18_200,
      },
      // Transform: two agents
      {
        type: "agent-queued",
        key: "1:Transform:a",
        label: "review:a.ts",
        phase: "Transform",
        at: 300,
      },
      { type: "agent-started", key: "1:Transform:a", at: 400 },
      { type: "agent-tool", key: "1:Transform:a", tool: { name: "Edit" }, at: 500 },
      { type: "agent-tool", key: "1:Transform:a", tool: { name: "Edit" }, at: 600 },
      {
        type: "agent-finished",
        key: "1:Transform:a",
        usage: { inputTokens: 21_000, outputTokens: 6_200 },
        cached: false,
        at: 14_400,
      },
      {
        type: "agent-queued",
        key: "2:Transform:b",
        label: "review:b.ts",
        phase: "Transform",
        at: 700,
      },
      { type: "agent-started", key: "2:Transform:b", at: 800 },
      {
        type: "agent-finished",
        key: "2:Transform:b",
        usage: { inputTokens: 10_000, outputTokens: 2_000 },
        cached: false,
        at: 20_000,
      },
      { type: "run-finished", runId: "r1" as RunId, at: 22_000 },
    ]);

    const report = selectRunReport(state);

    expect(report.runId).toBe("r1");
    expect(report.name).toBe("refactor-imports");
    expect(report.status).toBe("finished");
    expect(report.wallMs).toBe(22_000);

    expect(report.totals.agents).toBe(3);
    expect(report.totals.cached).toBe(0);
    expect(report.totals.failed).toBe(0);
    expect(report.totals.inputTokens).toBe(53_000);
    expect(report.totals.outputTokens).toBe(12_200);
    expect(report.totals.toolCalls).toBe(3);

    expect(report.budget).toEqual({ total: 500_000, spent: 12_200, pct: 2 });

    // Phases ordered by first phase-started.
    expect(report.phases.map((p) => p.title)).toEqual(["Discover", "Transform"]);
    const transform = report.phases[1]!;
    expect(transform.agents).toBe(2);
    expect(transform.inputTokens).toBe(31_000);
    expect(transform.outputTokens).toBe(8_200);
    expect(transform.toolCalls).toBe(2);
    expect(transform.wallMs).toBe(20_000 - 400); // last endedAt − first startedAt in phase

    // Agents ordered by startedAt.
    expect(report.agents.map((a) => a.label)).toEqual(["scan", "review:a.ts", "review:b.ts"]);
    const scan = report.agents[0]!;
    expect(scan.phase).toBe("Discover");
    expect(scan.status).toBe("done");
    expect(scan.model).toBe("claude-opus-4-8[1m]");
    expect(scan.inputTokens).toBe(22_000);
    expect(scan.outputTokens).toBe(4_000);
    expect(scan.toolCalls).toBe(1);
    expect(scan.wallMs).toBe(18_200 - 200);
    expect(scan.queuedMs).toBe(200 - 100);
  });

  it("excludes cached agents from token totals but counts them as cached", () => {
    const state = build([
      { type: "run-started", runId: "r" as RunId, name: "d", at: 0 },
      { type: "agent-queued", key: "0", label: "fresh", phase: "P", at: 0 },
      { type: "agent-started", key: "0", at: 1 },
      {
        type: "agent-finished",
        key: "0",
        usage: { inputTokens: 100, outputTokens: 50 },
        cached: false,
        at: 2,
      },
      { type: "agent-queued", key: "1", label: "replayed", phase: "P", at: 0 },
      {
        type: "agent-finished",
        key: "1",
        usage: { inputTokens: 0, outputTokens: 40 },
        cached: true,
        at: 1,
      },
      { type: "run-finished", runId: "r" as RunId, at: 3 },
    ]);
    const report = selectRunReport(state);
    expect(report.totals.cached).toBe(1);
    expect(report.totals.inputTokens).toBe(100);
    expect(report.totals.outputTokens).toBe(50); // cached agent's 40 excluded
    const replayed = report.agents.find((a) => a.label === "replayed")!;
    expect(replayed.status).toBe("cached");
    const phase = report.phases[0]!;
    expect(phase.inputTokens).toBe(100);
    expect(phase.outputTokens).toBe(50);
  });

  it("omits the budget line when no budget is set", () => {
    const state = build([
      { type: "run-started", runId: "r" as RunId, name: "d", budgetTotal: null, at: 0 },
      { type: "run-finished", runId: "r" as RunId, at: 1 },
    ]);
    expect(selectRunReport(state).budget).toBeUndefined();
  });

  it("flags approximate totals when any agent's usage was estimated", () => {
    const state = build([
      { type: "run-started", runId: "r" as RunId, name: "d", at: 0 },
      { type: "agent-queued", key: "0", label: "a", phase: "P", at: 0 },
      {
        type: "agent-finished",
        key: "0",
        usage: { inputTokens: 5, outputTokens: 5, approximate: true },
        cached: false,
        at: 1,
      },
    ]);
    expect(selectRunReport(state).totals.approximate).toBe(true);
  });

  it("reports a still-running run with running status and no wall time", () => {
    const state = build([
      { type: "run-started", runId: "r" as RunId, name: "d", at: 1000 },
      { type: "agent-queued", key: "0", label: "a", phase: "P", at: 1000 },
      { type: "agent-started", key: "0", at: 1100 },
    ]);
    const report = selectRunReport(state);
    expect(report.status).toBe("running");
    expect(report.wallMs).toBeUndefined();
  });

  it("counts failed agents and accepts a failed status override", () => {
    const state = build([
      { type: "run-started", runId: "r" as RunId, name: "d", at: 0 },
      { type: "agent-queued", key: "0", label: "a", phase: "P", at: 0 },
      { type: "agent-started", key: "0", at: 1 },
      {
        type: "agent-failed",
        key: "0",
        error: { kind: "AdapterSpawn", adapter: "claude", cause: "boom" },
        at: 2,
      },
      { type: "run-finished", runId: "r" as RunId, at: 3 },
    ]);
    const report = selectRunReport(state, { status: "failed" });
    expect(report.status).toBe("failed");
    expect(report.totals.failed).toBe(1);
    expect(report.agents[0]!.status).toBe("failed");
  });

  it("only includes phases that actually ran", () => {
    const state = build([
      { type: "run-started", runId: "r" as RunId, name: "d", at: 0 },
      // Seeded declared phases (no agents).
      { type: "phase-started", phase: "Discover", at: 0 },
      { type: "phase-started", phase: "Transform", at: 0 },
      { type: "phase-started", phase: "Verify", at: 0 },
      { type: "agent-queued", key: "0", label: "a", phase: "Transform", at: 1 },
      { type: "agent-started", key: "0", at: 2 },
      {
        type: "agent-finished",
        key: "0",
        usage: { inputTokens: 1, outputTokens: 1 },
        cached: false,
        at: 3,
      },
      { type: "run-finished", runId: "r" as RunId, at: 4 },
    ]);
    expect(selectRunReport(state).phases.map((p) => p.title)).toEqual(["Transform"]);
  });
});
