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

  it("runs a defineWorkflow default export", async () => {
    const loaded = loadWorkflow(`import { defineWorkflow, agent } from "workflow";

export default defineWorkflow({
  name: "defined",
  description: "d",
  harness: "claude",
  async run() {
    const out = await agent("find", { label: "a" });
    return { out };
  },
});`);

    const runner = createScriptedRunner({ a: { text: "hit" } });
    const runtime = createRuntime({
      runner,
      semaphore: createSemaphore(4),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: null,
      cwd: "/tmp",
      runId: "r-define",
      emit: () => {},
      now: () => 0,
    });

    await expect(loaded.run(runtime, undefined)).resolves.toEqual({ out: "hit" });
  });

  it("routes askUserQuestion() to the runtime's askUser handler", async () => {
    const loaded = loadWorkflow(`export const meta = { name: "q", description: "d", harness: "claude" }
const ans = await askUserQuestion({ key: "deploy-target", question: "Where?" });
return { ans };`);

    const runtime = createRuntime({
      runner: createScriptedRunner({}),
      semaphore: createSemaphore(4),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: null,
      cwd: "/tmp",
      runId: "rq",
      emit: () => {},
      now: () => 0,
      askUser: async (req) => `chose ${req.key}`,
    });

    await expect(loaded.run(runtime, undefined)).resolves.toEqual({ ans: "chose deploy-target" });
  });

  it("provides askUserQuestion on a defineWorkflow run context", async () => {
    const loaded = loadWorkflow(`import { defineWorkflow } from "workflow";
export default defineWorkflow({
  name: "q2",
  description: "d",
  harness: "claude",
  async run({ askUserQuestion }) {
    const ans = await askUserQuestion({ key: "k", question: "?" });
    return { ans };
  },
});`);

    const runtime = createRuntime({
      runner: createScriptedRunner({}),
      semaphore: createSemaphore(4),
      journal: createJournal(),
      maxAgents: 1000,
      budgetTotal: null,
      args: null,
      cwd: "/tmp",
      runId: "rq2",
      emit: () => {},
      now: () => 0,
      askUser: async (req) => `picked ${req.key}`,
    });

    await expect(loaded.run(runtime, undefined)).resolves.toEqual({ ans: "picked k" });
  });

  it("validates an agent's structured output against a plain JSON Schema", async () => {
    const SCHEMA_SCRIPT = `export const meta = { name: "s", description: "d", harness: "claude" }
const Out = { type: "object", properties: { ok: { type: "boolean" }, n: { type: "number" } }, required: ["ok", "n"] };
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
const Out = { type: "object", properties: { n: { type: "number" } }, required: ["n"] };
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
