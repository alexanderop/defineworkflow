import { describe, it, expect } from "vitest";
import type { RunId } from "./brand.js";
import { createScriptedRunner } from "./scripted-runner.js";
import type { AgentRequest, RunCtx } from "./types.js";

// `core` is the foundation `@workflow/test-support` is built on, so it can't import the shared
// factories from there without creating a workspace dependency cycle that breaks the clean build
// (the SCC would make pnpm build core/adapters/test-support unordered). These two leaf builders
// mirror `@workflow/test-support`'s `agentRequest`/`runCtx` — keep them in sync.
const agentRequest = (o: Partial<AgentRequest> = {}): AgentRequest => ({
  prompt: "p",
  cwd: "/tmp",
  signal: new AbortController().signal,
  ...o,
});
const runCtx = (o: Partial<RunCtx> = {}): RunCtx => ({ runId: "r1" as RunId, seq: 0, ...o });

describe("ScriptedRunner", () => {
  it("returns canned results matched by label, with default usage", async () => {
    const runner = createScriptedRunner({
      "research:a": { text: "found A", data: { items: 1 }, outputTokens: 12 },
    });
    const res = await runner.run(agentRequest({ label: "research:a" }), runCtx());
    expect(res.isOk()).toBe(true);
    const r = res._unsafeUnwrap();
    expect(r.text).toBe("found A");
    expect(r.data).toEqual({ items: 1 });
    expect(r.usage.outputTokens).toBe(12);
  });

  it("tracks peak concurrency via inFlight()", async () => {
    const runner = createScriptedRunner({}, { delayMs: 10 });
    const reqs = Array.from({ length: 3 }, (_, i) =>
      runner.run(agentRequest({ label: `x${i}` }), runCtx({ seq: i })),
    );
    await new Promise((r) => setTimeout(r, 2));
    expect(runner.inFlight()).toBe(3);
    await Promise.all(reqs);
    expect(runner.inFlight()).toBe(0);
  });
});
