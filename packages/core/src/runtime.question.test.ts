import { describe, it, expect } from "vitest";
import type { RunId } from "./brand.js";
import { createRuntime } from "./runtime.js";
import { createScriptedRunner } from "./scripted-runner.js";
import { createJournal } from "./journal.js";
import { createSemaphore } from "./semaphore.js";
import type { WorkflowEvent } from "./events.js";
import type { Journal } from "./journal.js";
import type { QuestionRequest } from "./runtime.js";

function harness(
  opts: { askUser?: (req: QuestionRequest) => Promise<string>; journal?: Journal } = {},
) {
  const events: WorkflowEvent[] = [];
  let clock = 0;
  const journal = opts.journal ?? createJournal();
  const rt = createRuntime({
    runner: createScriptedRunner({}),
    semaphore: createSemaphore(8),
    journal,
    maxAgents: 1000,
    budgetTotal: null,
    args: {},
    cwd: "/tmp",
    runId: "r1" as RunId,
    emit: (e) => events.push(e),
    now: () => clock++,
    ...(opts.askUser ? { askUser: opts.askUser } : {}),
  });
  return { rt, events, journal };
}

describe("runtime.askUserQuestion", () => {
  it("returns the answer resolved by the askUser handler", async () => {
    const { rt } = harness({ askUser: async (req) => `answer to ${req.key}` });
    const ans = await rt.askUserQuestion({ key: "deploy-target", question: "Where?" });
    expect(ans).toBe("answer to deploy-target");
  });

  it("emits question-asked then question-answered around the prompt", async () => {
    const { rt, events } = harness({ askUser: async () => "production" });
    await rt.askUserQuestion({
      key: "deploy-target",
      question: "Where?",
      choices: ["staging", "production"],
    });
    const qEvents = events.filter(
      (e) => e.type === "question-asked" || e.type === "question-answered",
    );
    expect(qEvents.map((e) => e.type)).toEqual(["question-asked", "question-answered"]);
    expect(qEvents[0]).toMatchObject({
      type: "question-asked",
      key: "deploy-target",
      question: "Where?",
      choices: ["staging", "production"],
    });
    expect(qEvents[1]).toMatchObject({
      type: "question-answered",
      key: "deploy-target",
      answer: "production",
      cached: false,
    });
  });

  it("serializes concurrent questions — only one prompt in flight at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const release: Array<() => void> = [];
    const { rt } = harness({
      askUser: (req) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise<string>((resolve) => {
          release.push(() => {
            inFlight--;
            resolve(req.key);
          });
        });
      },
    });
    const all = Promise.all([
      rt.askUserQuestion({ key: "a", question: "?" }),
      rt.askUserQuestion({ key: "b", question: "?" }),
    ]);
    // Drain the lock one prompt at a time: yield first so a question reaches askUser, then
    // release it. Only one askUser should ever be open at the macrotask boundary.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 0));
      if (release.length > 0) release.shift()!();
    }
    const answers = await all;
    expect(answers).toEqual(["a", "b"]);
    expect(maxInFlight).toBe(1);
  });

  it("replays a question answer when the question identity matches", async () => {
    const first = harness({ askUser: async () => "production" });
    await first.rt.askUserQuestion({ key: "deploy-target", question: "Where?" });

    let called = false;
    const resumed = harness({
      journal: createJournal(first.journal.records()),
      askUser: async () => {
        called = true;
        return "staging";
      },
    });

    const ans = await resumed.rt.askUserQuestion({ key: "deploy-target", question: "Where?" });

    expect(ans).toBe("production");
    expect(called).toBe(false);
  });

  it("re-asks when the question text changes", async () => {
    const first = harness({ askUser: async () => "production" });
    await first.rt.askUserQuestion({ key: "deploy-target", question: "Where?" });
    const resumed = harness({
      journal: createJournal(first.journal.records()),
      askUser: async () => "staging",
    });

    const ans = await resumed.rt.askUserQuestion({ key: "deploy-target", question: "Where now?" });

    expect(ans).toBe("staging");
  });

  it("releases the question lock when askUser rejects, so later questions still resolve", async () => {
    let calls = 0;
    const { rt } = harness({
      askUser: async (req) => {
        calls++;
        if (req.key === "first") throw new Error("boom");
        return `answer to ${req.key}`;
      },
    });

    // The first prompt rejects from the handler.
    await expect(rt.askUserQuestion({ key: "first", question: "?" })).rejects.toThrow(/boom/);

    // Without a `finally { releaseLock() }`, questionTail would stay unresolved and this
    // second await would deadlock forever.
    const second = await rt.askUserQuestion({ key: "second", question: "?" });
    expect(second).toBe("answer to second");
    expect(calls).toBe(2);
  });
});
