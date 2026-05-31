import { z } from "zod";
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

/**
 * Full-shape validation of a journal line — every field the durable-resume machinery replays, not
 * the old 2-field (`seq`/`key`) duck check that let a line missing `text`/`outputTokens` through as
 * a structurally-lying `JournalEntry`. `data` is genuinely arbitrary JSON, hence `z.unknown()`; it's
 * `undefined` for text-only agent results, which `JSON.stringify` drops from the serialized line, so
 * it must be `.optional()` — zod v4 treats a bare `z.unknown()` key as non-optional (missing fails).
 */
const journalEntrySchema = z.object({
  seq: z.number(),
  key: z.string(),
  text: z.string(),
  data: z.unknown().optional(),
  outputTokens: z.number(),
});

export function serializeEvent(event: WorkflowEvent): string {
  return JSON.stringify(event) + "\n";
}

export function serializeJournalEntry(entry: JournalEntry): string {
  return JSON.stringify(entry) + "\n";
}

export function parseEventLine(line: string): Result<WorkflowEvent, WorkflowError> {
  return parseJson(line).andThen((value) =>
    isEventLike(value) ? ok(value) : err(corrupt("not a workflow event (missing string `type`)")),
  );
}

export function parseJournalLine(line: string): Result<JournalEntry, WorkflowError> {
  return parseJson(line).andThen((value) => {
    const result = journalEntrySchema.safeParse(value);
    if (!result.success)
      return err(corrupt("not a journal entry (expected seq/key/text/data/outputTokens)"));
    // oxlint-disable-next-line typescript/consistent-type-assertions -- validated shape; z.unknown() leaves `data` optional in zod's inferred type, narrowed to JournalEntry at this trusted disk boundary
    return ok(result.data as JournalEntry);
  });
}
