import { describe, it, expect } from "vitest";
import { createRuntime } from "./runtime.js";
import { createScriptedRunner } from "./scripted-runner.js";
import { createJournal } from "./journal.js";
import { createSemaphore } from "./semaphore.js";

describe("nested workflow()", () => {
  it("runs a child workflow that shares the parent budget, and rejects double-nesting", async () => {
    const runner = createScriptedRunner({ child: { text: "kid", outputTokens: 7 } });
    const r = createRuntime({
      runner,
      semaphore: createSemaphore(4),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: 100,
      args: {},
      cwd: "/tmp",
      runId: "r",
      emit: () => {},
      now: () => 0,
      resolveWorkflow: async (name) => {
        expect(name).toBe("kid-flow");
        return {
          meta: { name: "kid-flow", description: "", harness: "raw-api", phases: [] },
          run: async (childRt) => {
            return childRt.agent("hi", { label: "child" });
          },
        };
      },
    });

    const out = await r.workflow("kid-flow");
    expect(out).toBe("kid");
    expect(r.budget.spent()).toBe(7);

    const runner2 = createScriptedRunner({});
    const r2 = createRuntime({
      runner: runner2,
      semaphore: createSemaphore(4),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r2",
      emit: () => {},
      now: () => 0,
      resolveWorkflow: async () => ({
        meta: { name: "x", description: "", harness: "raw-api", phases: [] },
        run: async (childRt) => childRt.workflow("again"),
      }),
    });
    await expect(r2.workflow("x")).rejects.toThrow(/one level/);
  });
});
