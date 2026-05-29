import { describe, it, expect } from "vitest";
import { createRuntime } from "./runtime.js";
import { createScriptedRunner } from "./scripted-runner.js";
import { createJournal } from "./journal.js";
import { createSemaphore } from "./semaphore.js";

describe("resume", () => {
  it("returns journaled results without calling the runner, then runs the rest live", async () => {
    const journal = createJournal([
      { seq: 0, key: "0:default:a", text: "cachedA", data: undefined, outputTokens: 5 },
    ]);
    const runner = createScriptedRunner({ b: { text: "liveB" } });

    const r = createRuntime({
      runner,
      semaphore: createSemaphore(8),
      journal,
      maxAgents: 1000,
      budgetTotal: null,
      args: {},
      cwd: "/tmp",
      runId: "r",
      emit: () => {},
      now: () => 0,
    });

    const a = await r.agent("p", { label: "a" }); // seq 0 -> cached
    const b = await r.agent("p", { label: "b" }); // seq 1 -> live

    expect(a).toBe("cachedA");
    expect(b).toBe("liveB");
    expect(runner.callCount()).toBe(1);
  });
});
