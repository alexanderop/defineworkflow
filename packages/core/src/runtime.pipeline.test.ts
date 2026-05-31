import { describe, it, expect } from "vitest";
import type { RunId } from "./brand.js";
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
      runId: "r" as RunId,
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
      runId: "r" as RunId,
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

  it("threads item and index to every stage and runs stages in order", async () => {
    const seen: Array<{ stage: number; prev: unknown; item: unknown; index: number }> = [];
    const r = createRuntime({
      runner: createScriptedRunner({}),
      semaphore: createSemaphore(8),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r" as RunId,
      emit: () => {},
      now: () => 0,
    });
    const out = await r.pipeline(
      ["x", "y"],
      async (prev, item, index) => {
        seen.push({ stage: 1, prev, item, index });
        return `${item}-1`;
      },
      async (prev, item, index) => {
        seen.push({ stage: 2, prev, item, index });
        return `${prev}-2`;
      },
    );
    expect(out).toEqual(["x-1-2", "y-1-2"]);
    // stage 1 sees prev === item (the original); stage 2 sees stage 1's return as prev, item unchanged.
    expect(seen).toContainEqual({ stage: 1, prev: "x", item: "x", index: 0 });
    expect(seen).toContainEqual({ stage: 2, prev: "x-1", item: "x", index: 0 });
    expect(seen).toContainEqual({ stage: 2, prev: "y-1", item: "y", index: 1 });
  });
});
