import { ok, err, type Result } from "neverthrow";
import type { WorkflowError, WorkflowEvent, JournalEntry } from "@workflow/core";

const corrupt = (detail: string): WorkflowError => ({ kind: "JournalCorrupt", runId: "", detail });

function parseJson(line: string): Result<unknown, WorkflowError> {
  const trimmed = line.trim();
  if (trimmed === "") return err(corrupt("empty line"));
  try {
    return ok(JSON.parse(trimmed));
  } catch (e) {
    return err(corrupt(`invalid JSON: ${e instanceof Error ? e.message : String(e)}`));
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const isEventLike = (v: unknown): v is WorkflowEvent =>
  isRecord(v) && typeof v["type"] === "string";

const isJournalEntryLike = (v: unknown): v is JournalEntry =>
  isRecord(v) && typeof v["seq"] === "number" && typeof v["key"] === "string";

export function serializeEvent(event: WorkflowEvent): string {
  return JSON.stringify(event) + "\n";
}

export function serializeJournalEntry(entry: JournalEntry): string {
  return JSON.stringify(entry) + "\n";
}

export function parseEventLine(line: string): Result<WorkflowEvent, WorkflowError> {
  return parseJson(line).andThen((value) =>
    isEventLike(value)
      ? ok(value)
      : err(corrupt("not a workflow event (missing string `type`)")),
  );
}

export function parseJournalLine(line: string): Result<JournalEntry, WorkflowError> {
  return parseJson(line).andThen((value) =>
    isJournalEntryLike(value)
      ? ok(value)
      : err(corrupt("not a journal entry (missing `seq`/`key`)")),
  );
}
