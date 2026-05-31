import { describe, it, expect } from "vitest";
import type { RunId } from "@workflow/core";
import { workflowSource } from "@workflow/test-support";
import { resumeCommand } from "./resume.js";
import type { ScriptHash } from "../registry.js";
import { fakeDeps, runMeta } from "../test-support.js";

// A workflow whose declared harness (raw-api) resolves via fakeDeps' `complete`.
const SRC = workflowSource({ name: "r", harness: "raw-api" });
// fakeDeps' clock.hash is `h:${s.length}` — match it so the same-script guard passes.
const matchingHash = (s: string) => `h:${s.length}` as ScriptHash;

describe("resumeCommand", () => {
  it("returns 1 for an unknown run id", async () => {
    const { deps, out } = fakeDeps();
    expect(await resumeCommand("nope", deps)).toBe(1);
    expect(out()).toContain("no run nope");
  });

  it("returns 1 and reports JournalCorrupt when the script hash does not match the snapshot", async () => {
    const { deps, out } = fakeDeps();
    deps.registry.init(
      runMeta({ runId: "r1" as RunId, adapter: "raw-api", scriptHash: "stale-hash" as ScriptHash }),
      SRC,
    );

    expect(await resumeCommand("r1", deps)).toBe(1);
    expect(out()).toContain("JournalCorrupt");
  });

  it("re-runs and finishes a run whose snapshot hash matches", async () => {
    const { deps } = fakeDeps({ ui: { start: () => ({ unmount: () => {} }) } });
    deps.registry.init(
      runMeta({ runId: "r1" as RunId, adapter: "raw-api", scriptHash: matchingHash(SRC) }),
      SRC,
    );

    const code = await resumeCommand("r1", deps);

    expect(code).toBe(0);
    expect(deps.registry.readMeta("r1")?.status).toBe("finished");
  });
});
