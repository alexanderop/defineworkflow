import { describe, it, expect, vi } from "vitest";
import type { RunId } from "./brand.js";
import { z } from "zod";
import { createRuntime, type AgentOptions } from "./runtime.js";
import { createScriptedRunner } from "./scripted-runner.js";
import { createJournal } from "./journal.js";
import { createSemaphore } from "./semaphore.js";
import type { WorkflowEvent } from "./events.js";
import type { AgentRunner, AgentRequest, AgentResult, RunCtx } from "./types.js";
import { ok } from "neverthrow";

function harness(responses = {}, opts = {}) {
  const events: WorkflowEvent[] = [];
  let clock = 0;
  const rt = createRuntime({
    runner: createScriptedRunner(responses, opts),
    semaphore: createSemaphore(8),
    journal: createJournal(),
    maxAgents: 1000,
    budgetTotal: null,
    args: { topic: "vue" },
    cwd: "/tmp",
    runId: "r1" as RunId,
    emit: (e) => events.push(e),
    now: () => clock++,
  });
  return { rt, events };
}

describe("runtime.agent", () => {
  it("returns the text when no schema is given and exposes args", async () => {
    const { rt } = harness({ "agent": { text: "hello" } });
    expect(rt.args).toEqual({ topic: "vue" });
    const out = await rt.agent("say hi", { label: "agent" });
    expect(out).toBe("hello");
  });

  it("accepts a zod schema, converting it before validating the agent's data", async () => {
    const { rt } = harness({ "a": { data: { n: 7 } } });
    const out = await rt.agent("give n", { label: "a", schema: z.object({ n: z.number() }) });
    expect(out).toEqual({ n: 7 });
  });

  it("converts a zod schema to JSON Schema in the emitted AgentRequest", async () => {
    let captured: AgentRequest | undefined;
    const runner: AgentRunner = {
      id: "spy",
      capabilities: { nativeSchema: true, reportsTokens: true, toolEvents: false },
      run: async (req: AgentRequest, _ctx: RunCtx) => {
        captured = req;
        return ok<AgentResult>({ text: '{"n":1}', data: { n: 1 }, usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [] });
      },
    };
    const rt = createRuntime({
      runner,
      semaphore: createSemaphore(1),
      journal: createJournal(),
      maxAgents: 10,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r1" as RunId,
      emit: () => {},
      now: () => 0,
    });
    const out = await rt.agent("p", { label: "a", schema: z.object({ n: z.number() }) });
    expect(out).toEqual({ n: 1 });
    expect(captured?.schema).toBeDefined();
    expect(captured?.schema?.["type"]).toBe("object");
    expect((captured?.schema?.["properties"] as Record<string, unknown> | undefined)?.["n"]).toBeDefined();
  });

  it("fails with SchemaValidation when a non-zod schema object reaches agent()", async () => {
    const { rt } = harness({ "a": { data: { n: 7 } } });
    // A plain JSON Schema object is only reachable from type-erased sandbox JS — simulate that
    // ingress past the (now zod-only) AgentOptions type.
    const opts = { label: "a", schema: { type: "object", properties: { n: { type: "number" } } } } as unknown as AgentOptions;
    await expect(rt.agent("give n", opts)).rejects.toMatchObject({ workflowError: { kind: "SchemaValidation" } });
  });

  it("rejects data that violates a zod schema with a SchemaValidation error", async () => {
    const { rt } = harness({ "a": { text: "n is five", data: { n: "five" } } });
    await expect(
      rt.agent("give n", { label: "a", schema: z.object({ n: z.number() }) }),
    ).rejects.toMatchObject({ workflowError: { kind: "SchemaValidation" } });
  });

  it("surfaces the model's raw output when re-validation fails", async () => {
    const { rt } = harness({ "a": { text: "I think n is five", data: { n: "five" } } });
    await expect(
      rt.agent("give n", { label: "a", schema: z.object({ n: z.number() }) }),
    ).rejects.toMatchObject({
      workflowError: { kind: "SchemaValidation", rawOutput: "I think n is five" },
    });
  });

  it("records spend against the budget", async () => {
    const { rt } = harness({ "a": { text: "x", outputTokens: 25 } });
    await rt.agent("p", { label: "a" });
    expect(rt.budget.spent()).toBe(25);
  });

  it("emits queued/started/finished events for an agent", async () => {
    const { rt, events } = harness({ "a": { text: "x" } });
    rt.phase("Search");
    await rt.agent("p", { label: "a" });
    const types = events.map((e) => e.type);
    expect(types).toEqual(["phase-started", "agent-queued", "agent-started", "agent-output", "agent-finished"]);
  });

  it("throws when the runner fails, so parallel can null it", async () => {
    const { rt } = harness({ "a": { fail: { kind: "AdapterSpawn", adapter: "scripted", cause: "boom" } } });
    await expect(rt.agent("p", { label: "a" })).rejects.toThrow();
  });
});

describe("resolveRunner: per-call adapter dispatch", () => {
  it("routes to runnerB when adapter matches, and falls back to default runner for unknown id", async () => {
    const events: WorkflowEvent[] = [];
    const runnerA = createScriptedRunner({ x: { text: "from-a" } });
    const runnerB = createScriptedRunner({ x: { text: "from-b" } });
    const rt = createRuntime({
      runner: runnerA,
      semaphore: createSemaphore(8),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r1" as RunId,
      emit: (e) => events.push(e),
      now: () => 0,
      resolveRunner: (id) => (id === "b" ? runnerB : undefined),
    });

    // adapter "b" → runnerB
    await rt.agent("p", { label: "x", adapter: "b" });
    expect(runnerB.callCount()).toBe(1);
    expect(runnerA.callCount()).toBe(0);

    // unknown adapter "zzz" → falls back to runnerA
    await rt.agent("p", { label: "x", adapter: "zzz" });
    expect(runnerA.callCount()).toBe(1);
    expect(runnerB.callCount()).toBe(1);
  });
});

describe("runtime stop/pause hooks", () => {
  it("an already-aborted signal rejects agent() without invoking the runner", async () => {
    const events: WorkflowEvent[] = [];
    const runner = createScriptedRunner({ a: { text: "x" } });
    const controller = new AbortController();
    controller.abort();
    const rt = createRuntime({
      runner,
      semaphore: createSemaphore(8),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r1" as RunId,
      emit: (e) => events.push(e),
      now: () => 0,
      signal: controller.signal,
    });
    await expect(rt.agent("p", { label: "a" })).rejects.toThrow();
    expect(runner.callCount()).toBe(0);
    expect(events.map((e) => e.type)).toContain("agent-failed");
  });

  it("awaits the gate before starting the agent (pause)", async () => {
    const events: WorkflowEvent[] = [];
    const runner = createScriptedRunner({ a: { text: "x" } });
    let release!: () => void;
    const gatePromise = new Promise<void>((r) => (release = r));
    const rt = createRuntime({
      runner,
      semaphore: createSemaphore(8),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r1" as RunId,
      emit: (e) => events.push(e),
      now: () => 0,
      gate: () => gatePromise,
    });
    const pending = rt.agent("p", { label: "a" });
    await Promise.resolve();
    expect(events.map((e) => e.type)).not.toContain("agent-started");
    release();
    await pending;
    expect(events.map((e) => e.type)).toContain("agent-started");
  });
});

describe("makeIsolatedCwd: worktree isolation hook", () => {
  /** A recording runner that captures the cwd from each AgentRequest. */
  function createRecordingRunner(response: AgentResult): AgentRunner & { lastCwd(): string | undefined } {
    let lastCwd: string | undefined;
    return {
      id: "recording",
      capabilities: { nativeSchema: true, reportsTokens: true, toolEvents: false },
      run: async (req: AgentRequest, _ctx: RunCtx) => {
        lastCwd = req.cwd;
        return ok(response);
      },
      lastCwd: () => lastCwd,
    };
  }

  it("passes the isolated cwd to the runner and calls cleanup once", async () => {
    const cleanup = vi.fn(async () => undefined as void);
    const runner = createRecordingRunner({
      text: "ok",
      data: undefined,
      usage: { inputTokens: 0, outputTokens: 0 },
      toolCalls: [],
    });

    const rt = createRuntime({
      runner,
      semaphore: createSemaphore(8),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r1" as RunId,
      emit: () => {},
      now: () => 0,
      makeIsolatedCwd: async (key) => ({ cwd: "/wt/" + key, cleanup }),
    });

    await rt.agent("p", { label: "a", isolation: "worktree" });

    // key format: `${seq}:${phase}:${label}` — first agent: seq=0, phase="default", label="a"
    expect(runner.lastCwd()).toBe("/wt/0:default:a");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("uses deps.cwd when isolation is not requested and never calls makeIsolatedCwd", async () => {
    const makeIsolatedCwd = vi.fn(async (_key: string) => ({
      cwd: "/wt/should-not-be-used",
      cleanup: vi.fn(async () => undefined as void),
    }));
    const runner = createRecordingRunner({
      text: "ok",
      data: undefined,
      usage: { inputTokens: 0, outputTokens: 0 },
      toolCalls: [],
    });

    const rt = createRuntime({
      runner,
      semaphore: createSemaphore(8),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r1" as RunId,
      emit: () => {},
      now: () => 0,
      makeIsolatedCwd,
    });

    await rt.agent("p", { label: "a" });

    expect(runner.lastCwd()).toBe("/tmp");
    expect(makeIsolatedCwd).not.toHaveBeenCalled();
  });
});

describe("runtime.agent progress + labels", () => {
  // A runner that drives ctx.onProgress with a scripted sequence before resolving.
  function progressRunner(updates: ReadonlyArray<Parameters<NonNullable<RunCtx["onProgress"]>>[0]>): AgentRunner {
    return {
      id: "p",
      capabilities: { nativeSchema: true, reportsTokens: true, toolEvents: true },
      run: async (_req: AgentRequest, ctx: RunCtx) => {
        for (const u of updates) ctx.onProgress?.(u);
        return ok<AgentResult>({ text: "done", usage: { inputTokens: 0, outputTokens: 1 }, toolCalls: [] });
      },
    };
  }

  function progressHarness(runner: AgentRunner, now: () => number) {
    const events: WorkflowEvent[] = [];
    const rt = createRuntime({
      runner,
      semaphore: createSemaphore(8),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r1" as RunId,
      emit: (e) => events.push(e),
      now,
    });
    return { rt, events };
  }

  it("emits agent-tool per tool call observed via onProgress", async () => {
    const runner = progressRunner([{ tool: { name: "WebFetch", input: { url: "x" } } }, { tool: { name: "WebSearch" } }]);
    const { rt, events } = progressHarness(runner, () => 0);
    await rt.agent("p", { label: "a" });
    const tools = events.filter((e) => e.type === "agent-tool");
    expect(tools.map((t) => (t as { tool: { name: string } }).tool.name)).toEqual(["WebFetch", "WebSearch"]);
  });

  it("coalesces token/model progress to <=1/sec and carries model into agent-finished", async () => {
    let clock = 0;
    // first update at t=0 (emits), second at t=500 (dropped), third at t=1500 (emits)
    const times = [0, 500, 1500, 2000];
    const now = () => times[clock++] ?? 9999;
    const runner = progressRunner([
      { tokens: 100, model: "claude-opus-4-8[1m]" },
      { tokens: 200 },
      { tokens: 300 },
    ]);
    const { rt, events } = progressHarness(runner, now);
    await rt.agent("p", { label: "a" });
    const progress = events.filter((e) => e.type === "agent-progress") as Array<{ tokens?: number; model?: string }>;
    expect(progress.length).toBe(2);
    expect(progress[0]).toMatchObject({ tokens: 100, model: "claude-opus-4-8[1m]" });
    expect(progress[1]?.tokens).toBe(300);
    const finished = events.find((e) => e.type === "agent-finished") as { model?: string };
    expect(finished.model).toBe("claude-opus-4-8[1m]");
  });

  it("derives an agent label from the prompt's first non-empty line when unlabeled", async () => {
    const { rt, events } = progressHarness(progressRunner([]), () => 0);
    await rt.agent("\n  Use the WebFetch tool to gather posts\nmore detail here");
    const queued = events.find((e) => e.type === "agent-queued") as { label: string };
    expect(queued.label).toBe("Use the WebFetch tool to gather posts");
  });
});
