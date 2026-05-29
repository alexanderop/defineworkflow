import { describe, it, expect } from "vitest";
import { createRuntime } from "./runtime.js";
import { createScriptedRunner } from "./scripted-runner.js";
import { createJournal } from "./journal.js";
import { createSemaphore } from "./semaphore.js";

describe("pipeline", () => {
  it("runs stages per-item with no barrier (fast item finishes while slow item lags)", async () => {
    const order: string[] = [];
    const r = createRuntime({
      runner: createScriptedRunner({}),
      semaphore: createSemaphore(8),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r",
      emit: () => {},
      now: () => 0,
    });

    const stage1 = async (_prev: unknown, item: unknown) => {
      const delay = item === "slow" ? 30 : 1;
      await new Promise((res) => setTimeout(res, delay));
      order.push(`s1:${item}`);
      return item;
    };
    const stage2 = async (_prev: unknown, item: unknown) => {
      order.push(`s2:${item}`);
      return item;
    };

    await r.pipeline(["slow", "fast"], stage1, stage2);
    expect(order.indexOf("s2:fast")).toBeLessThan(order.indexOf("s1:slow"));
  });

  it("drops a throwing item to null without killing the others", async () => {
    const r = createRuntime({
      runner: createScriptedRunner({}),
      semaphore: createSemaphore(8),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r",
      emit: () => {},
      now: () => 0,
    });
    const out = await r.pipeline(
      [1, 2],
      async (_p, item) => {
        if (item === 1) throw new Error("nope");
        return item;
      },
    );
    expect(out).toEqual([null, 2]);
  });
});
