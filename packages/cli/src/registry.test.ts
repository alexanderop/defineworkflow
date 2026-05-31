import { describe, it, expect } from "vitest";
import type { ScriptHash } from "./registry.js";
import type { JournalKey, RunId } from "@workflow/core";
import type { WorkflowEvent } from "@workflow/core";
import { createRegistry, type RegistryFs, type RunMeta } from "./registry.js";

/** In-memory fs fake: dirs are keys ending in "/" tracked in a Set; files in a Map. */
function memFs(): RegistryFs & { dump(): Record<string, string> } {
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
        .map((d) => d.slice(dir.length + 1).split("/")[0]!)
        .filter((v, i, a) => a.indexOf(v) === i),
    exists: (p) => files.has(p) || dirs.has(p),
    dump: () => Object.fromEntries(files),
  };
}

const baseMeta: RunMeta = {
  runId: "demo-1" as RunId,
  name: "demo",
  scriptPath: "/s.ts",
  args: { topic: "vue" },
  adapter: "codex",
  status: "running",
  startedAt: 100,
  endedAt: null,
  pid: 4242,
  scriptHash: "h" as ScriptHash,
};

function setup() {
  const fs = memFs();
  const reg = createRegistry({ root: "/runs", fs });
  return { fs, reg };
}

describe("registry", () => {
  it("init writes meta.json + script.snapshot, mkdir the run dir", () => {
    const { reg } = setup();
    reg.init(baseMeta, "export const meta = {};\n");
    expect(reg.readMeta("demo-1")).toEqual(baseMeta);
    expect(reg.readScript("demo-1")).toBe("export const meta = {};\n");
  });

  it("updateMeta patches the stored meta", () => {
    const { reg } = setup();
    reg.init(baseMeta, "x");
    reg.updateMeta("demo-1", { status: "finished", endedAt: 200 });
    const m = reg.readMeta("demo-1")!;
    expect(m.status).toBe("finished");
    expect(m.endedAt).toBe(200);
    expect(m.name).toBe("demo");
  });

  it("readMeta rejects a non-conforming meta.json (validated at the disk boundary)", () => {
    const { fs, reg } = setup();
    // A truncated / old-format meta.json: valid JSON, wrong shape (status not in the enum).
    fs.writeFile("/runs/bad/meta.json", JSON.stringify({ runId: "bad", status: "bogus" }));
    expect(reg.readMeta("bad")).toBeUndefined();
  });

  it("readMeta returns undefined for malformed JSON", () => {
    const { fs, reg } = setup();
    fs.writeFile("/runs/bad/meta.json", "{ not json");
    expect(reg.readMeta("bad")).toBeUndefined();
  });

  it("listRuns drops runs whose meta.json fails validation", () => {
    const { fs, reg } = setup();
    reg.init(baseMeta, "x");
    fs.mkdirp("/runs/corrupt");
    fs.writeFile("/runs/corrupt/meta.json", JSON.stringify({ garbage: true }));
    expect(reg.listRuns()).toEqual([baseMeta]);
  });

  it("appendEvent + readEvents round-trips events in order", () => {
    const { reg } = setup();
    reg.init(baseMeta, "x");
    const events: WorkflowEvent[] = [
      { type: "run-started", runId: "demo-1" as RunId, name: "demo", at: 1 },
      { type: "phase-started", phase: "Search", at: 2 },
      { type: "run-finished", runId: "demo-1" as RunId, at: 3 },
    ];
    for (const e of events) reg.appendEvent("demo-1", e);
    expect(reg.readEvents("demo-1")).toEqual(events);
  });

  it("persistentJournal records to memory and to journal.jsonl", () => {
    const { reg } = setup();
    reg.init(baseMeta, "x");
    const journal = reg.persistentJournal("demo-1", []);
    journal.recordStarted({
      type: "started",
      seq: 0,
      journalKey: "v2:k" as JournalKey,
      agentKey: "0:P:a",
    });
    journal.recordResult({
      type: "result",
      seq: 0,
      journalKey: "v2:k" as JournalKey,
      agentKey: "0:P:a",
      text: "hi",
      data: null,
      outputTokens: 9,
    });
    expect(journal.lookup("v2:k" as JournalKey)?.text).toBe("hi");
    const fromDisk = reg.readJournal("demo-1");
    expect(fromDisk.isOk()).toBe(true);
    expect(fromDisk._unsafeUnwrap()).toEqual([
      { type: "started", seq: 0, journalKey: "v2:k", agentKey: "0:P:a" },
      {
        type: "result",
        seq: 0,
        journalKey: "v2:k",
        agentKey: "0:P:a",
        text: "hi",
        data: null,
        outputTokens: 9,
      },
    ]);
  });

  it("readJournal surfaces JournalCorrupt on a bad line", () => {
    const { fs, reg } = setup();
    reg.init(baseMeta, "x");
    fs.appendFile("/runs/demo-1/journal.jsonl", "{not json\n");
    expect(reg.readJournal("demo-1").isErr()).toBe(true);
  });

  it("listRuns returns all runs' meta", () => {
    const { reg } = setup();
    reg.init(baseMeta, "x");
    reg.init({ ...baseMeta, runId: "demo-2" as RunId, name: "other" }, "y");
    const ids = reg
      .listRuns()
      .map((m) => m.runId)
      .sort();
    expect(ids).toEqual(["demo-1", "demo-2"]);
  });
});
