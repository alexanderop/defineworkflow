import { describe, it, expect } from "vitest";
import type { JournalKey, JournalRecord, RunId, WorkflowEvent } from "@workflow/core";
import {
  serializeEvent,
  serializeJournalRecord,
  parseEventLine,
  parseJournalLine,
} from "./jsonl.js";

describe("jsonl events", () => {
  it("round-trips an event", () => {
    const e: WorkflowEvent = { type: "run-started", runId: "r1" as RunId, name: "demo", at: 5 };
    const line = serializeEvent(e);
    expect(line.endsWith("\n")).toBe(true);
    const parsed = parseEventLine(line.trimEnd());
    expect(parsed.isOk()).toBe(true);
    expect(parsed._unsafeUnwrap()).toEqual(e);
  });

  it("returns JournalCorrupt on a malformed event line", () => {
    const bad = parseEventLine("{not json");
    expect(bad.isErr()).toBe(true);
    expect(bad._unsafeUnwrapErr().kind).toBe("JournalCorrupt");
  });

  it("returns JournalCorrupt on a JSON value that is not an event", () => {
    const bad = parseEventLine(JSON.stringify({ foo: 1 }));
    expect(bad.isErr()).toBe(true);
    expect(bad._unsafeUnwrapErr().kind).toBe("JournalCorrupt");
  });
});

describe("jsonl journal", () => {
  it("round-trips a journal result record", () => {
    const entry: JournalRecord = {
      type: "result",
      seq: 0,
      journalKey: "v2:abc" as JournalKey,
      agentKey: "0:P:a",
      text: "hi",
      data: { n: 1 },
      outputTokens: 9,
    };
    const parsed = parseJournalLine(serializeJournalRecord(entry));
    expect(parsed.isOk()).toBe(true);
    expect(parsed._unsafeUnwrap()).toEqual(entry);
  });

  it("round-trips a journal started record", () => {
    const entry: JournalRecord = {
      type: "started",
      seq: 0,
      journalKey: "v2:abc" as JournalKey,
      agentKey: "0:P:a",
    };
    const parsed = parseJournalLine(serializeJournalRecord(entry));
    expect(parsed.isOk()).toBe(true);
    expect(parsed._unsafeUnwrap()).toEqual(entry);
  });

  it("returns JournalCorrupt on a blank line", () => {
    expect(parseJournalLine("   ").isErr()).toBe(true);
  });

  it("returns JournalCorrupt when type/journalKey are missing", () => {
    expect(parseJournalLine(JSON.stringify({ text: "x" })).isErr()).toBe(true);
  });

  it("rejects an entry missing replay-critical fields (text/outputTokens), not just seq/key", () => {
    // The old 2-field duck check let this through as a result whose text/outputTokens
    // were actually undefined — a type lie on the data durable-resume replays.
    const bad = parseJournalLine(
      JSON.stringify({ type: "result", seq: 1, journalKey: "v2:k", agentKey: "1:P:a" }),
    );
    expect(bad.isErr()).toBe(true);
    expect(bad._unsafeUnwrapErr().kind).toBe("JournalCorrupt");
  });

  it("rejects an entry whose field types are wrong", () => {
    const bad = parseJournalLine(
      JSON.stringify({
        type: "result",
        seq: "1",
        journalKey: "v2:k",
        agentKey: "a",
        text: "t",
        data: null,
        outputTokens: 3,
      }),
    );
    expect(bad.isErr()).toBe(true);
  });
});
