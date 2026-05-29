import { ok, err, type Result } from "neverthrow";
import type { WorkflowError, WorkflowEvent, JournalEntry } from "@workflow/core";

const corrupt = (detail: string): WorkflowError => ({ kind: "JournalCorrupt", runId: "", detail });

function parseJson(line: string): Result<unknown, WorkflowError> {
  const trimmed = line.trim();
  if (trimmed === "") return err(corrupt("empty line"));
  try {
    return ok(JSON.parse(trimmed));
  } catch (e) {
    return err(corrupt(`invalid JSON: ${(e as Error).message}`));
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function serializeEvent(event: WorkflowEvent): string {
  return JSON.stringify(event) + "\n";
}

export function serializeJournalEntry(entry: JournalEntry): string {
  return JSON.stringify(entry) + "\n";
}

export function parseEventLine(line: string): Result<WorkflowEvent, WorkflowError> {
  return parseJson(line).andThen((value) =>
    isRecord(value) && typeof value["type"] === "string"
      ? ok(value as unknown as WorkflowEvent)
      : err(corrupt("not a workflow event (missing string `type`)")),
  );
}

export function parseJournalLine(line: string): Result<JournalEntry, WorkflowError> {
  return parseJson(line).andThen((value) =>
    isRecord(value) && typeof value["seq"] === "number" && typeof value["key"] === "string"
      ? ok(value as unknown as JournalEntry)
      : err(corrupt("not a journal entry (missing `seq`/`key`)")),
  );
}
