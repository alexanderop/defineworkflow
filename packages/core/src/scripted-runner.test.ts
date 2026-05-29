import { describe, it, expect } from "vitest";
import { createScriptedRunner } from "./scripted-runner.js";

describe("ScriptedRunner", () => {
  it("returns canned results matched by label, with default usage", async () => {
    const runner = createScriptedRunner({
      "research:a": { text: "found A", data: { items: 1 }, outputTokens: 12 },
    });
    const ctrl = new AbortController();
    const res = await runner.run(
      { prompt: "p", cwd: "/tmp", signal: ctrl.signal, label: "research:a" },
      { runId: "r", seq: 0 },
    );
    expect(res.isOk()).toBe(true);
    const r = res._unsafeUnwrap();
    expect(r.text).toBe("found A");
    expect(r.data).toEqual({ items: 1 });
    expect(r.usage.outputTokens).toBe(12);
  });

  it("tracks peak concurrency via inFlight()", async () => {
    const runner = createScriptedRunner({}, { delayMs: 10 });
    const ctrl = new AbortController();
    const reqs = Array.from({ length: 3 }, (_, i) =>
      runner.run({ prompt: "p", cwd: "/tmp", signal: ctrl.signal, label: `x${i}` }, { runId: "r", seq: i }),
    );
    await new Promise((r) => setTimeout(r, 2));
    expect(runner.inFlight()).toBe(3);
    await Promise.all(reqs);
    expect(runner.inFlight()).toBe(0);
  });
});
