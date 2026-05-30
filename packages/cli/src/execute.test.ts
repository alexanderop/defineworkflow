import { describe, it, expect } from "vitest";
import { createMockRunner } from "@workflow/core";
import type { WorkflowEvent } from "@workflow/core";
import type { StartUiOptions } from "@workflow/ui";
import { createRegistry, type RegistryFs, type RunMeta } from "./registry.js";
import { runForeground } from "./execute.js";
import type { AppDeps } from "./app.js";

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
const explodingProcessRunner = {
  run: () => {
    throw new Error("processRunner must not be called during a --mock run");
  },
};

function fakeDeps(registry: ReturnType<typeof createRegistry>, events: WorkflowEvent[]): AppDeps {
  return {
    registry,
    config: {},
    cwd: "/tmp",
    homeDir: "/tmp/home",
    tmpDir: "/tmp/tmp",
    cores: 4,
    env: {},
    isTTY: false,
    ci: true,
    now: () => 0,
    rand: () => 0,
    pid: () => 1,
    hash: () => "h",
    processRunner: explodingProcessRunner as AppDeps["processRunner"],
    // codex IS detected — so without --mock, the per-call `adapter: "codex"` override
    // would resolve to the real codex adapter and hit the exploding processRunner.
    detected: ["codex"],
    readTextFile: () => undefined,
    writeTextFile: () => {},
    print: () => {},
    bundledDir: "/tmp/bundled",
    startUi: (opts: StartUiOptions) => {
      opts.subscribe((e: WorkflowEvent) => events.push(e));
      return { unmount: () => {} };
    },
    consentIO: { question: async () => "", write: () => {} },
    persistConsent: () => {},
    spawnDetached: () => 1,
    killProcess: () => {},
    onSigterm: () => {},
    watchEvents: () => () => {},
  } as unknown as AppDeps;
}

const SOURCE = `
import { agent, defineWorkflow } from "defineworkflow";
export default defineWorkflow({
  name: "mocktest",
  description: "d",
  harness: "claude",
  async run() {
    const schema = { type: "object", properties: { x: { type: "number" } }, required: ["x"], additionalProperties: false };
    const a = await agent("first", { label: "a", schema });
    const b = await agent("second", { label: "b", adapter: "codex", schema });
    return { a, b };
  },
});
`;

describe("runForeground with --mock", () => {
  it("runs a workflow to completion using the mock runner without spawning processes", async () => {
    const registry = createRegistry({ root: "/tmp/runs", fs: memRegistryFs() });
    const runId = "mocktest-1";
    const meta: RunMeta = { runId, name: "mocktest", scriptPath: "s.ts", args: null, adapter: "claude", status: "running", startedAt: 0, endedAt: null, pid: null, scriptHash: "h" };
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
});
