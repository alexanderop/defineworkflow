import { describe, it, expect } from "vitest";
import type { ScriptHash } from "./registry.js";
import type { RunId } from "@workflow/core";
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
    readDir: (dir) =>
      [...dirs]
        .filter((d) => d.startsWith(dir + "/"))
        .map((d) => d.slice(dir.length + 1).split("/")[0]!),
    exists: (p) => files.has(p) || dirs.has(p),
  };
}

const SCRIPT = `export const meta = { name: "demo", description: "d", harness: "claude", phases: [{ title: "Search" }] } as const
phase("Search");
const a = await agent("first", { label: "a" });
const b = await agent("second", { label: "b" });
return { a, b };`;

const META: RunMeta = {
  runId: "demo-1" as RunId,
  name: "demo",
  scriptPath: null,
  args: {},
  adapter: "codex",
  status: "running",
  startedAt: 0,
  endedAt: null,
  pid: null,
  scriptHash: "h" as ScriptHash,
};

function wire(runId: RunId) {
  const reg = createRegistry({ root: "/runs", fs: memFs() });
  reg.init({ ...META, runId }, SCRIPT);
  const emit = (e: Parameters<typeof reg.appendEvent>[1]) => reg.appendEvent(runId, e);
  return { reg, emit };
}

describe("runWorkflow", () => {
  it("runs the script, returns its value, and persists events + journal", async () => {
    const { reg, emit } = wire("demo-1" as RunId);
    const runner = createScriptedRunner({
      a: { text: "A", outputTokens: 3 },
      b: { text: "B", outputTokens: 4 },
    });
    const result = await runWorkflow({
      source: SCRIPT,
      args: {},
      runner,
      runId: "demo-1" as RunId,
      cwd: "/tmp",
      concurrency: 4,
      maxAgents: 1000,
      budgetTotal: null,
      journal: reg.persistentJournal("demo-1", []),
      emit,
      now: () => 0,
    });

    expect(result._unsafeUnwrap().returnValue).toEqual({ a: "A", b: "B" });
    const types = reg.readEvents("demo-1").map((e) => e.type);
    expect(types[0]).toBe("run-started");
    expect(types[types.length - 1]).toBe("run-finished");
    expect(reg.readJournal("demo-1")._unsafeUnwrap()).toHaveLength(4);
  });

  it("carries budgetTotal onto the run-started event so a finished run can show the budget line", async () => {
    const { reg, emit } = wire("demo-b" as RunId);
    const runner = createScriptedRunner({ a: { text: "A" }, b: { text: "B" } });
    await runWorkflow({
      source: SCRIPT,
      args: {},
      runner,
      runId: "demo-b" as RunId,
      cwd: "/tmp",
      concurrency: 4,
      maxAgents: 1000,
      budgetTotal: 500_000,
      journal: reg.persistentJournal("demo-b", []),
      emit,
      now: () => 0,
    });
    const started = reg.readEvents("demo-b").find((e) => e.type === "run-started");
    expect(started).toMatchObject({ type: "run-started", budgetTotal: 500_000 });
  });

  it("seeds all declared meta.phases as phase-started events before the script reaches them", async () => {
    // Script declares three phases but only ever calls phase("Research") — the later
    // phase() calls would run after a long await, so without seeding the UI would only
    // ever see "Research" while research is in flight.
    const script = `export const meta = { name: "multi", description: "d", harness: "claude", phases: [{ title: "Research" }, { title: "Curate" }, { title: "Write" }] } as const
phase("Research");
const a = await agent("first", { label: "a" });
return { a };`;
    const reg = createRegistry({ root: "/runs", fs: memFs() });
    reg.init({ ...META, runId: "multi-1" as RunId }, script);
    const emit = (e: Parameters<typeof reg.appendEvent>[1]) => reg.appendEvent("multi-1", e);
    const runner = createScriptedRunner({ a: { text: "A" } });
    await runWorkflow({
      source: script,
      args: {},
      runner,
      runId: "multi-1" as RunId,
      cwd: "/tmp",
      concurrency: 4,
      maxAgents: 1000,
      budgetTotal: null,
      journal: reg.persistentJournal("multi-1", []),
      emit,
      now: () => 0,
    });

    const phaseTitles = reg
      .readEvents("multi-1")
      .filter((e): e is Extract<typeof e, { type: "phase-started" }> => e.type === "phase-started")
      .map((e) => e.phase);
    // All declared phases present, in declared order, deduped (Research seeded + re-emitted is fine).
    expect(phaseTitles.slice(0, 3)).toEqual(["Research", "Curate", "Write"]);
  });

  it("resume: a journal-seeded run reuses cached results without re-spawning", async () => {
    // First run to populate the journal.
    const first = wire("demo-2" as RunId);
    const r1 = createScriptedRunner({ a: { text: "A" }, b: { text: "B" } });
    await runWorkflow({
      source: SCRIPT,
      args: {},
      runner: r1,
      runId: "demo-2" as RunId,
      cwd: "/tmp",
      concurrency: 4,
      maxAgents: 1000,
      budgetTotal: null,
      journal: first.reg.persistentJournal("demo-2", []),
      emit: first.emit,
      now: () => 0,
    });
    expect(r1.callCount()).toBe(2);

    // Resume seeded from the journal: the runner must not be called again.
    const seed = first.reg.readJournal("demo-2")._unsafeUnwrap();
    const r2 = createScriptedRunner({ a: { text: "A" }, b: { text: "B" } });
    const resumed = await runWorkflow({
      source: SCRIPT,
      args: {},
      runner: r2,
      runId: "demo-2" as RunId,
      cwd: "/tmp",
      concurrency: 4,
      maxAgents: 1000,
      budgetTotal: null,
      journal: first.reg.persistentJournal("demo-2", seed),
      emit: () => {},
      now: () => 0,
    });
    expect(resumed._unsafeUnwrap().returnValue).toEqual({ a: "A", b: "B" });
    expect(r2.callCount()).toBe(0);
  });

  it("an already-aborted signal ends the run with no agent calls", async () => {
    const { reg, emit } = wire("demo-3" as RunId);
    const runner = createScriptedRunner({ a: { text: "A" }, b: { text: "B" } });
    const controller = new AbortController();
    controller.abort();
    const result = await runWorkflow({
      source: SCRIPT,
      args: {},
      runner,
      runId: "demo-3" as RunId,
      cwd: "/tmp",
      concurrency: 4,
      maxAgents: 1000,
      budgetTotal: null,
      journal: reg.persistentJournal("demo-3", []),
      emit,
      now: () => 0,
      signal: controller.signal,
    });
    expect(result.isErr()).toBe(true);
    expect(runner.callCount()).toBe(0);
    expect(reg.readEvents("demo-3").map((e) => e.type)).toContain("run-finished");
  });
});
