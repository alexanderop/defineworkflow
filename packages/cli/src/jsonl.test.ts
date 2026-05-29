import { describe, it, expect } from "vitest";
import type { WorkflowEvent, JournalEntry } from "@workflow/core";
import { serializeEvent, parseEventLine, parseJournalLine } from "./jsonl.js";

describe("jsonl events", () => {
  it("round-trips an event", () => {
    const e: WorkflowEvent = { type: "run-started", runId: "r1", name: "demo", at: 5 };
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
  it("round-trips a journal entry", () => {
    const entry: JournalEntry = { seq: 0, key: "0:P:a", text: "hi", data: { n: 1 }, outputTokens: 9 };
    const parsed = parseJournalLine(JSON.stringify(entry));
    expect(parsed.isOk()).toBe(true);
    expect(parsed._unsafeUnwrap()).toEqual(entry);
  });

  it("returns JournalCorrupt on a blank line", () => {
    expect(parseJournalLine("   ").isErr()).toBe(true);
  });

  it("returns JournalCorrupt when seq/key are missing", () => {
    expect(parseJournalLine(JSON.stringify({ text: "x" })).isErr()).toBe(true);
  });
});
