import { ok } from "neverthrow";
import type { RunId } from "./brand.js";
import { describe, expect, it } from "vitest";
import { createRuntime, type RuntimeDeps } from "./runtime.js";
import { createSemaphore } from "./semaphore.js";
import { createJournal } from "./journal.js";
import { profile } from "./profile.js";
import type { AgentRequest, AgentResult, AgentRunner, RunCtx } from "./types.js";
import type { WorkflowEvent } from "./events.js";

/** A runner that records every AgentRequest it receives so tests can assert on the merged opts. */
function createRecordingRunner(id: string, text = "ok"): AgentRunner & { calls: AgentRequest[] } {
  const calls: AgentRequest[] = [];
  const response: AgentResult = { text, data: undefined, usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [] };
  return {
    id,
    capabilities: { nativeSchema: true, reportsTokens: true, toolEvents: false },
    run: async (req: AgentRequest, _ctx: RunCtx) => {
      calls.push(req);
      return ok(response);
    },
    calls,
  };
}

const baseDeps = (runner: RuntimeDeps["runner"], over: Partial<RuntimeDeps> = {}): RuntimeDeps => ({
  runner,
  semaphore: createSemaphore(4),
  journal: createJournal(),
  maxAgents: 100,
  budgetTotal: null,
  args: null,
  cwd: "/tmp",
  runId: "test-run" as RunId,
  emit: () => {},
  now: () => 0,
  ...over,
});

describe("createRuntime agent() with profiles", () => {
  it("applies a profile's config to the agent call", async () => {
    const runner = createRecordingRunner("scripted");
    const runtime = createRuntime(baseDeps(runner));
    const reviewer = profile({ model: "sonnet", agentType: "reviewer" });
    await runtime.agent(reviewer, "review this");
    expect(runner.calls[0]?.model).toBe("sonnet");
    expect(runner.calls[0]?.agentType).toBe("reviewer");
  });

  it("routes a profile's adapter through resolveRunner", async () => {
    const fallback = createRecordingRunner("fallback", "fallback");
    const claude = createRecordingRunner("claude", "from-claude");
    const runtime = createRuntime(
      baseDeps(fallback, { resolveRunner: (id) => (id === "claude" ? claude : undefined) }),
    );
    const reviewer = profile({ adapter: "claude" });
    const result = await runtime.agent(reviewer, "review this");
    expect(result).toBe("from-claude");
    expect(claude.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0);
  });

  it("lets the call site override a profile field", async () => {
    const runner = createRecordingRunner("scripted");
    const runtime = createRuntime(baseDeps(runner));
    const reviewer = profile({ model: "sonnet" });
    await runtime.agent(reviewer, "review", { model: "opus" });
    expect(runner.calls[0]?.model).toBe("opus");
  });

  it("records overridden profile keys on agent-queued", async () => {
    const runner = createRecordingRunner("scripted");
    const events: WorkflowEvent[] = [];
    const runtime = createRuntime(baseDeps(runner, { emit: (e) => events.push(e) }));
    const reviewer = profile({ model: "sonnet" });
    await runtime.agent(reviewer, "review", { model: "opus" });
    const queued = events.find((e) => e.type === "agent-queued");
    if (queued?.type !== "agent-queued") throw new Error("expected agent-queued event");
    expect(queued.overrides).toEqual(["model"]);
  });

  it("does not flag an override when the call repeats the profile's value", async () => {
    const runner = createRecordingRunner("scripted");
    const events: WorkflowEvent[] = [];
    const runtime = createRuntime(baseDeps(runner, { emit: (e) => events.push(e) }));
    const reviewer = profile({ model: "sonnet" });
    await runtime.agent(reviewer, "review", { model: "sonnet" });
    const queued = events.find((e) => e.type === "agent-queued");
    if (queued?.type !== "agent-queued") throw new Error("expected agent-queued event");
    expect(queued.overrides).toBeUndefined();
  });

  it("prepends a profile's instructions to the request prompt", async () => {
    const runner = createRecordingRunner("scripted");
    const runtime = createRuntime(baseDeps(runner));
    const reviewer = profile({ instructions: "Be terse." });
    await runtime.agent(reviewer, "do it");
    expect(runner.calls[0]?.prompt).toBe("Be terse.\n\ndo it");
  });

  it("prepends instructions passed directly in opts (no profile)", async () => {
    const runner = createRecordingRunner("scripted");
    const runtime = createRuntime(baseDeps(runner));
    await runtime.agent("do it", { instructions: "Be terse." });
    expect(runner.calls[0]?.prompt).toBe("Be terse.\n\ndo it");
  });

  it("does not change the label/key from instructions (label still derives from raw prompt)", async () => {
    const runner = createRecordingRunner("scripted");
    const events: WorkflowEvent[] = [];
    const runtime = createRuntime(baseDeps(runner, { emit: (e) => events.push(e) }));
    const reviewer = profile({ instructions: "SYSTEM PERSONA TEXT" });
    await runtime.agent(reviewer, "fix the bug");
    const queued = events.find((e) => e.type === "agent-queued");
    if (queued?.type !== "agent-queued") throw new Error("expected agent-queued event");
    expect(queued.label).not.toContain("SYSTEM");
    expect(queued.prompt).toBe("fix the bug");
  });
});
