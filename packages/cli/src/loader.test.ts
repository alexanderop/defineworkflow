import { describe, it, expect } from "vitest";
import { createRuntime, createScriptedRunner, createJournal, createSemaphore } from "@workflow/core";
import { loadMeta, loadWorkflow } from "./loader.js";

const SCRIPT = `export const meta = { name: "demo", description: "d", harness: "claude", phases: [{ title: "Search" }] } as const
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

  it("injects `z` so a sandbox-built schema validates the agent's structured output", async () => {
    const SCHEMA_SCRIPT = `export const meta = { name: "s", description: "d", harness: "claude" }
const Out = z.object({ ok: z.boolean(), n: z.number() });
const res = await agent("do it", { label: "a", schema: Out });
return res;`;
    const loaded = loadWorkflow(SCHEMA_SCRIPT);

    const runner = createScriptedRunner({ a: { data: { ok: true, n: 7 } } });
    const runtime = createRuntime({
      runner,
      semaphore: createSemaphore(4),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: null,
      cwd: "/tmp",
      runId: "r2",
      emit: () => {},
      now: () => 0,
    });

    const result = await loaded.run(runtime, undefined);
    expect(result).toEqual({ ok: true, n: 7 });
  });

  it("surfaces a SchemaValidation error when output does not match the sandbox-built schema", async () => {
    const SCHEMA_SCRIPT = `export const meta = { name: "s", description: "d", harness: "claude" }
const Out = z.object({ n: z.number() });
return await agent("do it", { label: "a", schema: Out });`;
    const loaded = loadWorkflow(SCHEMA_SCRIPT);

    const runner = createScriptedRunner({ a: { data: { n: "not-a-number" } } });
    const runtime = createRuntime({
      runner,
      semaphore: createSemaphore(4),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: null,
      cwd: "/tmp",
      runId: "r3",
      emit: () => {},
      now: () => 0,
    });

    await expect(loaded.run(runtime, undefined)).rejects.toMatchObject({ workflowError: { kind: "SchemaValidation" } });
  });
});
