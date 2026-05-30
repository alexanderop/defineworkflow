import { describe, it, expect } from "vitest";
import type { RunId } from "./brand.js";
import { createRuntime } from "./runtime.js";
import { createScriptedRunner } from "./scripted-runner.js";
import { createJournal } from "./journal.js";
import { createSemaphore } from "./semaphore.js";

function make(maxAgents: number, budgetTotal: number | null, responses = {}) {
  return createRuntime({
    runner: createScriptedRunner(responses),
    semaphore: createSemaphore(8),
    journal: createJournal(),
    maxAgents,
    budgetTotal,
    args: {},
    cwd: "/tmp",
    runId: "r" as RunId,
    emit: () => {},
    now: () => 0,
  });
}

describe("limits", () => {
  it("throws AgentCapExceeded once the cap is reached", async () => {
    const r = make(1, null, { a: { text: "ok" }, b: { text: "ok" } });
    await r.agent("p", { label: "a" });
    await expect(r.agent("p", { label: "b" })).rejects.toThrow(/AgentCapExceeded/);
  });

  it("throws BudgetExhausted once spend reaches the total", async () => {
    const r = make(1000, 20, { a: { text: "x", outputTokens: 20 }, b: { text: "y" } });
    await r.agent("p", { label: "a" });
    await expect(r.agent("p", { label: "b" })).rejects.toThrow(/BudgetExhausted/);
  });
});
