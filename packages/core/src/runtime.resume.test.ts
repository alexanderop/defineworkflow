import { describe, it, expect } from "vitest";
import type { RunId } from "./brand.js";
import { createRuntime } from "./runtime.js";
import { createScriptedRunner } from "./scripted-runner.js";
import { createJournal } from "./journal.js";
import { createSemaphore } from "./semaphore.js";
import type { AgentOptions } from "./runtime.js";

function runtime(
  journal = createJournal(),
  responses: Parameters<typeof createScriptedRunner>[0] = {},
) {
  const events: Array<{ type: string; key?: string; cached?: boolean }> = [];
  const runner = createScriptedRunner(responses);
  const rt = createRuntime({
    runner,
    semaphore: createSemaphore(8),
    journal,
    maxAgents: 1000,
    budgetTotal: null,
    args: {},
    cwd: "/tmp",
    runId: "r" as RunId,
    emit: (e) => events.push(e),
    now: () => 0,
  });
  return { rt, runner, events, journal };
}

async function recordRun(
  calls: ReadonlyArray<{ prompt: string; opts: AgentOptions }>,
  responses: Parameters<typeof createScriptedRunner>[0],
) {
  const h = runtime(createJournal(), responses);
  const values = [];
  for (const call of calls) values.push(await h.rt.agent(call.prompt, call.opts));
  return { ...h, values };
}

describe("resume", () => {
  it("replays the same hash-chain without calling the runner", async () => {
    const first = await recordRun(
      [
        { prompt: "first", opts: { label: "a" } },
        { prompt: "second", opts: { label: "b" } },
      ],
      { a: { text: "A", outputTokens: 3 }, b: { text: "B", outputTokens: 4 } },
    );
    const resumed = runtime(createJournal(first.journal.records()), {
      a: { text: "freshA" },
      b: { text: "freshB" },
    });

    const a = await resumed.rt.agent("first", { label: "a" });
    const b = await resumed.rt.agent("second", { label: "b" });

    expect([a, b]).toEqual(["A", "B"]);
    expect(resumed.runner.callCount()).toBe(0);
  });

  it("reruns from the first changed prompt onward", async () => {
    const first = await recordRun(
      [
        { prompt: "first", opts: { label: "a" } },
        { prompt: "second", opts: { label: "b" } },
      ],
      { a: { text: "A" }, b: { text: "B" } },
    );
    const resumed = runtime(createJournal(first.journal.records()), {
      b: { text: "freshB" },
    });

    const a = await resumed.rt.agent("first", { label: "a" });
    const b = await resumed.rt.agent("changed-second", { label: "b" });

    expect([a, b]).toEqual(["A", "freshB"]);
    expect(resumed.runner.callCount()).toBe(1);
  });

  it("does not reuse matching later calls after the first miss", async () => {
    const first = await recordRun(
      [
        { prompt: "first", opts: { label: "a" } },
        { prompt: "second", opts: { label: "b" } },
        { prompt: "third", opts: { label: "c" } },
      ],
      { a: { text: "A" }, b: { text: "B" }, c: { text: "C" } },
    );
    const resumed = runtime(createJournal(first.journal.records()), {
      b: { text: "freshB" },
      c: { text: "freshC" },
    });

    const a = await resumed.rt.agent("first", { label: "a" });
    const b = await resumed.rt.agent("changed-second", { label: "b" });
    const c = await resumed.rt.agent("third", { label: "c" });

    expect([a, b, c]).toEqual(["A", "freshB", "freshC"]);
    expect(resumed.runner.callCount()).toBe(2);
  });

  it("keeps label and phase out of replay identity", async () => {
    const first = await recordRun(
      [
        { prompt: "first", opts: { label: "old-a", phase: "Old" } },
        { prompt: "second", opts: { label: "old-b", phase: "Old" } },
      ],
      { "old-a": { text: "A" }, "old-b": { text: "B" } },
    );
    const resumed = runtime(createJournal(first.journal.records()), {
      "new-a": { text: "freshA" },
      "new-b": { text: "freshB" },
    });

    const a = await resumed.rt.agent("first", { label: "new-a", phase: "New" });
    const b = await resumed.rt.agent("second", { label: "new-b", phase: "New" });

    expect([a, b]).toEqual(["A", "B"]);
    expect(resumed.runner.callCount()).toBe(0);
  });

  it("includes model in replay identity", async () => {
    const first = await recordRun([{ prompt: "first", opts: { label: "a", model: "sonnet" } }], {
      a: { text: "A" },
    });
    const resumed = runtime(createJournal(first.journal.records()), {
      a: { text: "freshA" },
    });

    const a = await resumed.rt.agent("first", { label: "a", model: "opus" });

    expect(a).toBe("freshA");
    expect(resumed.runner.callCount()).toBe(1);
  });
});
