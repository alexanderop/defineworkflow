import { describe, it, expect } from "vitest";
import type { RunId } from "@workflow/core";
import { workflowSource } from "@workflow/test-support";
import { runDetachedCommand } from "./run-detached.js";
import { fakeDeps, runMeta } from "../test-support.js";

const SRC = workflowSource({ name: "d", harness: "raw-api" });

describe("runDetachedCommand", () => {
  it("returns 1 for an unknown run id", async () => {
    const { deps } = fakeDeps();
    expect(await runDetachedCommand("nope", deps)).toBe(1);
  });

  it("marks the run failed when the adapter runner cannot be built", async () => {
    // raw-api with no `complete` fails to build -> the detached child must record failure,
    // not leave the run wedged in "running".
    const { deps } = fakeDeps({ adapters: { complete: undefined } });
    deps.registry.init(runMeta({ runId: "r1" as RunId, adapter: "raw-api" }), SRC);

    const code = await runDetachedCommand("r1", deps);

    expect(code).toBe(1);
    expect(deps.registry.readMeta("r1")?.status).toBe("failed");
    expect(deps.registry.readMeta("r1")?.endedAt).not.toBeNull();
  });

  it("records its pid and registers a SIGTERM handler before running", async () => {
    let sigtermHandler: (() => void) | undefined;
    const { deps } = fakeDeps({
      proc: { onSigterm: (fn) => void (sigtermHandler = fn) },
    });
    deps.registry.init(runMeta({ runId: "r1" as RunId, adapter: "raw-api", pid: null }), SRC);

    await runDetachedCommand("r1", deps);

    // pid stamped from clock.pid() (4242 in fakeDeps), and a handler was wired so `stop` can abort it.
    expect(deps.registry.readMeta("r1")?.pid).toBe(4242);
    expect(typeof sigtermHandler).toBe("function");
  });
});
