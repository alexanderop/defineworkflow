import { describe, it, expect } from "vitest";
import type { AgentKey, JournalKey } from "./brand.js";
import { computeJournalKey, createJournal } from "./journal.js";

describe("journal", () => {
  it("returns a miss before result, a hit after result, keyed by journal key", () => {
    const j = createJournal();
    const journalKey = "v2:k" as JournalKey;
    const agentKey = "0:Search:a" as AgentKey;
    expect(j.lookup(journalKey)).toBeUndefined();
    j.recordStarted({ type: "started", seq: 0, journalKey, agentKey });
    expect(j.lookup(journalKey)).toBeUndefined();
    j.recordResult({
      type: "result",
      seq: 0,
      journalKey,
      agentKey,
      data: { found: true },
      text: "x",
      outputTokens: 9,
    });
    const hit = j.lookup(journalKey);
    expect(hit?.data).toEqual({ found: true });
    expect(hit?.outputTokens).toBe(9);
  });

  it("serializes records in append order", () => {
    const j = createJournal();
    const journalKey = "v2:k" as JournalKey;
    const agentKey = "0:P:a" as AgentKey;
    j.recordStarted({ type: "started", seq: 0, journalKey, agentKey });
    j.recordResult({
      type: "result",
      seq: 0,
      journalKey,
      agentKey,
      data: 1,
      text: "",
      outputTokens: 0,
    });
    const restored = createJournal(j.records());
    expect(restored.lookup(journalKey)?.data).toBe(1);
  });

  it("folds the previous key into computed keys", () => {
    const first = computeJournalKey({ kind: "agent", prompt: "same", previousKey: null });
    const chained = computeJournalKey({ kind: "agent", prompt: "same", previousKey: first });
    const unchained = computeJournalKey({ kind: "agent", prompt: "same", previousKey: null });
    expect(chained).not.toBe(unchained);
    expect(first).toBe(unchained);
  });
});
