import { describe, it, expect } from "vitest";
import type { ScriptHash } from "./registry.js";
import type { RunId } from "@workflow/core";
import { createMockRunner } from "@workflow/core";
import type { WorkflowEvent } from "@workflow/core";
import type { ProcessRunner } from "@workflow/adapters";
import { createRegistry, type RegistryFs, type RunMeta } from "./registry.js";
import { runForeground, runHeadless, saveRun } from "./execute.js";
import { fakeDeps as makeFakeDeps } from "./test-support.js";

function memRegistryFs(): RegistryFs {
  const files = new Map<string, string>();
  return {
    mkdirp: () => {},
    writeFile: (p, data) => void files.set(p, data),
    appendFile: (p, data) => void files.set(p, (files.get(p) ?? "") + data),
    readFile: (p) => files.get(p),
    readDir: () => [],
    exists: (p) => files.has(p),
  };
}

// A throwing ProcessRunner proves a --mock run never spawns a real CLI.
const explodingProcessRunner: ProcessRunner = {
  run: () => {
    throw new Error("processRunner must not be called during a --mock run");
  },
};

/** A fake AppDeps whose UI forwards every event to `events`, with adapters that explode if spawned. */
function fakeDeps(registry: ReturnType<typeof createRegistry>, events: WorkflowEvent[]) {
  return makeFakeDeps({
    registry,
    // codex IS detected — so without --mock, the per-call `adapter: "codex"` override
    // would resolve to the real codex adapter and hit the exploding processRunner.
    adapters: { processRunner: explodingProcessRunner, detected: ["codex"] },
    ui: {
      start: (opts) => {
        opts.subscribe((e: WorkflowEvent) => events.push(e));
        return { unmount: () => {} };
      },
    },
  }).deps;
}

const SOURCE = `
import { agent, defineWorkflow, z } from "defineworkflow";
export default defineWorkflow({
  name: "mocktest",
  description: "d",
  harness: "claude",
  async run() {
    const schema = z.object({ x: z.number() });
    const a = await agent("first", { label: "a", schema });
    const b = await agent("second", { label: "b", adapter: "codex", schema });
    return { a, b };
  },
});
`;

describe("runForeground with --mock", () => {
  it("runs a workflow to completion using the mock runner without spawning processes", async () => {
    const registry = createRegistry({ root: "/tmp/runs", fs: memRegistryFs() });
    const runId = "mocktest-1" as RunId;
    const meta: RunMeta = {
      runId,
      name: "mocktest",
      scriptPath: "s.ts",
      args: null,
      adapter: "claude",
      status: "running",
      startedAt: 0,
      endedAt: null,
      pid: null,
      scriptHash: "h" as ScriptHash,
    };
    registry.init(meta, SOURCE);
    const events: WorkflowEvent[] = [];
    const deps = fakeDeps(registry, events);

    const code = await runForeground(deps, {
      runId,
      source: SOURCE,
      args: null,
      runner: createMockRunner(),
      adapter: "mock",
      seed: [],
      mock: true,
    });

    expect(code).toBe(0);
    expect(registry.readMeta(runId)?.status).toBe("finished");
    // Both agents finished — including the one with a per-call `adapter: "codex"` override,
    // which proves --mock also intercepts per-call adapter dispatch.
    const finished = events.filter((e) => e.type === "agent-finished");
    expect(finished.length).toBe(2);
  });

  it("prints a run report when the foreground run finishes", async () => {
    const registry = createRegistry({ root: "/tmp/runs", fs: memRegistryFs() });
    const runId = "mocktest-2" as RunId;
    const meta: RunMeta = {
      runId,
      name: "mocktest",
      scriptPath: "s.ts",
      args: null,
      adapter: "claude",
      status: "running",
      startedAt: 0,
      endedAt: null,
      pid: null,
      scriptHash: "h" as ScriptHash,
    };
    registry.init(meta, SOURCE);
    const events: WorkflowEvent[] = [];
    const prints: string[] = [];
    const base = fakeDeps(registry, events);
    const deps = { ...base, ui: { ...base.ui, print: (t: string) => void prints.push(t) } };

    await runForeground(deps, {
      runId,
      source: SOURCE,
      args: null,
      runner: createMockRunner(),
      adapter: "mock",
      seed: [],
      mock: true,
    });

    const out = prints.join("");
    expect(out).toContain("Run  mocktest");
    expect(out).toContain("finished");
    expect(out).toContain("Tokens");
    expect(out).toContain("Agents");
  });
});

describe("saveRun", () => {
  it("persists the self-contained workflow bundle verbatim", () => {
    // A bundled snapshot: helpers inlined, `export { wf as default }`, NO `./` relative imports.
    const bundled = [
      `var S = ({});`,
      `var wf = defineWorkflow({ name: "mf", description: "d", harness: "claude" });`,
      `export { wf as default };`,
    ].join("\n");

    const registry = createRegistry({ root: "/tmp/runs", fs: memRegistryFs() });
    const runId = "run-1" as RunId;
    const meta: RunMeta = {
      runId,
      name: "mf",
      scriptPath: "s.ts",
      args: null,
      adapter: "claude",
      status: "finished",
      startedAt: 0,
      endedAt: 1,
      pid: null,
      scriptHash: "h" as ScriptHash,
    };
    registry.init(meta, bundled);

    let captured: { p: string; d: string } | undefined;
    const { deps } = makeFakeDeps({
      registry,
      io: { writeText: (p: string, d: string) => void (captured = { p, d }) },
    });

    const path = saveRun(deps, runId);

    expect(path).toMatch(/\/workflows\/mf\.ts$/);
    expect(captured?.p).toBe(path);
    // The bundle is persisted byte-for-byte, and is self-contained (no relative imports).
    expect(captured?.d).toBe(bundled);
    expect(captured?.d).not.toMatch(/from\s*["']\.\//);
  });
});

const HEADLESS_SRC = `
import { agent, defineWorkflow } from "defineworkflow";
export default defineWorkflow({
  name: "hl",
  description: "d",
  harness: "claude",
  async run() {
    return await agent("hi", { label: "a" });
  },
});
`;

describe("runHeadless", () => {
  it("finishes the run, persists status=finished, and records events via the registry", async () => {
    const registry = createRegistry({ root: "/tmp/runs", fs: memRegistryFs() });
    const runId = "hl-1" as RunId;
    const meta: RunMeta = {
      runId,
      name: "hl",
      scriptPath: "s.ts",
      args: null,
      adapter: "claude",
      status: "running",
      startedAt: 0,
      endedAt: null,
      pid: 4242,
      scriptHash: "h" as ScriptHash,
    };
    registry.init(meta, HEADLESS_SRC);
    const { deps } = makeFakeDeps({ registry });

    const code = await runHeadless(
      deps,
      {
        runId,
        source: HEADLESS_SRC,
        args: null,
        runner: createMockRunner(),
        adapter: "mock",
        seed: [],
      },
      new AbortController(),
    );

    expect(code).toBe(0);
    expect(registry.readMeta(runId)?.status).toBe("finished");
    expect(registry.readEvents(runId).some((e) => e.type === "agent-finished")).toBe(true);
  });

  it("returns exit 1, marks status=stopped, and writes no artifacts when pre-aborted", async () => {
    const registry = createRegistry({ root: "/tmp/runs", fs: memRegistryFs() });
    const runId = "hl-2" as RunId;
    const meta: RunMeta = {
      runId,
      name: "hl",
      scriptPath: "s.ts",
      args: null,
      adapter: "claude",
      status: "running",
      startedAt: 0,
      endedAt: null,
      pid: 4242,
      scriptHash: "h" as ScriptHash,
    };
    registry.init(meta, HEADLESS_SRC);
    const prints: string[] = [];
    const base = makeFakeDeps({ registry }).deps;
    const deps = { ...base, ui: { ...base.ui, print: (t: string) => void prints.push(t) } };

    const controller = new AbortController();
    controller.abort();

    const code = await runHeadless(
      deps,
      {
        runId,
        source: HEADLESS_SRC,
        args: null,
        runner: createMockRunner(),
        adapter: "mock",
        seed: [],
      },
      controller,
    );

    expect(code).toBe(1);
    expect(registry.readMeta(runId)?.status).toBe("stopped");
    // No artifacts emitted on the error/abort path.
    expect(prints.join("")).not.toContain("artifacts →");
  });
});
