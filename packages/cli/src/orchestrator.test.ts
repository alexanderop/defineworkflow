import { describe, it, expect } from "vitest";
import { createScriptedRunner } from "@workflow/core";
import { createRegistry, type RegistryFs, type RunMeta } from "./registry.js";
import { runWorkflow } from "./orchestrator.js";

function memFs(): RegistryFs {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    mkdirp: (dir) => dirs.add(dir),
    writeFile: (p, data) => files.set(p, data),
    appendFile: (p, data) => files.set(p, (files.get(p) ?? "") + data),
    readFile: (p) => files.get(p),
    readDir: (dir) => [...dirs].filter((d) => d.startsWith(dir + "/")).map((d) => d.slice(dir.length + 1).split("/")[0]!),
    exists: (p) => files.has(p) || dirs.has(p),
  };
}

const SCRIPT = `export const meta = { name: "demo", description: "d", phases: [{ title: "Search" }] } as const
phase("Search");
const a = await agent("first", { label: "a" });
const b = await agent("second", { label: "b" });
return { a, b };`;

const META: RunMeta = {
  runId: "demo-1", name: "demo", scriptPath: null, args: {}, adapter: "codex",
  status: "running", startedAt: 0, endedAt: null, pid: null, scriptHash: "h",
};

function wire(runId: string) {
  const reg = createRegistry({ root: "/runs", fs: memFs() });
  reg.init({ ...META, runId }, SCRIPT);
  const emit = (e: Parameters<typeof reg.appendEvent>[1]) => reg.appendEvent(runId, e);
  return { reg, emit };
}

describe("runWorkflow", () => {
  it("runs the script, returns its value, and persists events + journal", async () => {
    const { reg, emit } = wire("demo-1");
    const runner = createScriptedRunner({ a: { text: "A", outputTokens: 3 }, b: { text: "B", outputTokens: 4 } });
    const result = await runWorkflow({
      source: SCRIPT, args: {}, runner, runId: "demo-1", cwd: "/tmp",
      concurrency: 4, maxAgents: 1000, budgetTotal: null,
      journal: reg.persistentJournal("demo-1", []), emit, now: () => 0,
    });

    expect(result._unsafeUnwrap().returnValue).toEqual({ a: "A", b: "B" });
    const types = reg.readEvents("demo-1").map((e) => e.type);
    expect(types[0]).toBe("run-started");
    expect(types[types.length - 1]).toBe("run-finished");
    expect(reg.readJournal("demo-1")._unsafeUnwrap()).toHaveLength(2);
  });

  it("resume: a journal-seeded run reuses cached results without re-spawning", async () => {
    // First run to populate the journal.
    const first = wire("demo-2");
    const r1 = createScriptedRunner({ a: { text: "A" }, b: { text: "B" } });
    await runWorkflow({
      source: SCRIPT, args: {}, runner: r1, runId: "demo-2", cwd: "/tmp",
      concurrency: 4, maxAgents: 1000, budgetTotal: null,
      journal: first.reg.persistentJournal("demo-2", []), emit: first.emit, now: () => 0,
    });
    expect(r1.callCount()).toBe(2);

    // Resume seeded from the journal: the runner must not be called again.
    const seed = first.reg.readJournal("demo-2")._unsafeUnwrap();
    const r2 = createScriptedRunner({ a: { text: "A" }, b: { text: "B" } });
    const resumed = await runWorkflow({
      source: SCRIPT, args: {}, runner: r2, runId: "demo-2", cwd: "/tmp",
      concurrency: 4, maxAgents: 1000, budgetTotal: null,
      journal: first.reg.persistentJournal("demo-2", seed), emit: () => {}, now: () => 0,
    });
    expect(resumed._unsafeUnwrap().returnValue).toEqual({ a: "A", b: "B" });
    expect(r2.callCount()).toBe(0);
  });

  it("an already-aborted signal ends the run with no agent calls", async () => {
    const { reg, emit } = wire("demo-3");
    const runner = createScriptedRunner({ a: { text: "A" }, b: { text: "B" } });
    const controller = new AbortController();
    controller.abort();
    const result = await runWorkflow({
      source: SCRIPT, args: {}, runner, runId: "demo-3", cwd: "/tmp",
      concurrency: 4, maxAgents: 1000, budgetTotal: null,
      journal: reg.persistentJournal("demo-3", []), emit, now: () => 0, signal: controller.signal,
    });
    expect(result.isErr()).toBe(true);
    expect(runner.callCount()).toBe(0);
    expect(reg.readEvents("demo-3").map((e) => e.type)).toContain("run-finished");
  });
});
