import { describe, it, expect } from "vitest";
import type { RunId } from "@workflow/core";
import { stopCommand } from "./stop.js";
import { fakeDeps, runMeta } from "../test-support.js";

describe("stopCommand", () => {
  it("returns 1 and prints an error for an unknown run id", () => {
    const { deps, out } = fakeDeps();
    expect(stopCommand("nope", deps)).toBe(1);
    expect(out()).toContain("no run nope");
  });

  it("is a no-op (exit 0) for a run that is not running", () => {
    const { deps, out } = fakeDeps();
    deps.registry.init(runMeta({ runId: "r1" as RunId, status: "finished" }), "src");
    expect(stopCommand("r1", deps)).toBe(0);
    expect(out()).toContain("already finished");
  });

  it("SIGTERMs the recorded pid and marks the run stopped", () => {
    const killed: Array<{ pid: number; sig: string }> = [];
    const { deps, out } = fakeDeps({ proc: { kill: (pid, sig) => void killed.push({ pid, sig }) } });
    deps.registry.init(runMeta({ runId: "r1" as RunId, status: "running", pid: 555 }), "src");

    expect(stopCommand("r1", deps)).toBe(0);

    expect(killed).toEqual([{ pid: 555, sig: "SIGTERM" }]);
    expect(deps.registry.readMeta("r1")?.status).toBe("stopped");
    expect(out()).toContain("stopped r1");
  });

  it("still marks the run stopped when kill throws (process already gone)", () => {
    const { deps } = fakeDeps({
      proc: {
        kill: () => {
          throw new Error("ESRCH");
        },
      },
    });
    deps.registry.init(runMeta({ runId: "r1" as RunId, status: "running", pid: 999 }), "src");

    expect(stopCommand("r1", deps)).toBe(0);
    expect(deps.registry.readMeta("r1")?.status).toBe("stopped");
  });

  it("marks a running run with a null pid stopped without calling kill", () => {
    let killCalls = 0;
    const { deps } = fakeDeps({ proc: { kill: () => void killCalls++ } });
    deps.registry.init(runMeta({ runId: "r1" as RunId, status: "running", pid: null }), "src");

    expect(stopCommand("r1", deps)).toBe(0);
    expect(killCalls).toBe(0);
    expect(deps.registry.readMeta("r1")?.status).toBe("stopped");
  });
});
