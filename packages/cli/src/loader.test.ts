import { describe, it, expect } from "vitest";
import { createRuntime, createScriptedRunner, createJournal, createSemaphore } from "@workflow/core";
import { loadMeta, loadWorkflow } from "./loader.js";

const SCRIPT = `export const meta = { name: "demo", description: "d", phases: [{ title: "Search" }] } as const
phase("Search");
const out = await agent("find " + args.topic, { label: "a" });
return { out };`;

describe("loadMeta", () => {
  it("reads name + phases without running the body", () => {
    const meta = loadMeta(SCRIPT);
    expect(meta.name).toBe("demo");
    expect(meta.phases).toEqual([{ title: "Search" }]);
  });
});

describe("loadWorkflow", () => {
  it("runs the script against a runtime, routing agent() to the runner", async () => {
    const loaded = loadWorkflow(SCRIPT);
    expect(loaded.meta.name).toBe("demo");

    const runner = createScriptedRunner({ a: { text: "hit" } });
    const runtime = createRuntime({
      runner,
      semaphore: createSemaphore(4),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: { topic: "vue" },
      cwd: "/tmp",
      runId: "r1",
      emit: () => {},
      now: () => 0,
    });

    const result = await loaded.run(runtime, { topic: "vue" });
    expect(result).toEqual({ out: "hit" });
    expect(runner.callCount()).toBe(1);
  });
});
