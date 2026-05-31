import { z } from "zod";
import { ok, err, type Result } from "neverthrow";
import type { WorkflowError, WorkflowEvent, JournalRecord } from "@workflow/core";

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
 * Full-shape validation of a journal line — every field the durable-resume machinery replays.
 * `data` is genuinely arbitrary JSON, hence `z.unknown()`. It is absent for text-only agent
 * results, so it must be `.optional()`.
 */
const journalStartedSchema = z.object({
  type: z.literal("started"),
  seq: z.number(),
  journalKey: z.string().startsWith("v2:"),
  agentKey: z.string(),
});

const journalResultSchema = z.object({
  type: z.literal("result"),
  seq: z.number(),
  journalKey: z.string().startsWith("v2:"),
  agentKey: z.string(),
  text: z.string(),
  data: z.unknown().optional(),
  outputTokens: z.number(),
});

const journalRecordSchema = z.discriminatedUnion("type", [
  journalStartedSchema,
  journalResultSchema,
]);

export function serializeEvent(event: WorkflowEvent): string {
  return JSON.stringify(event) + "\n";
}

export function serializeJournalRecord(record: JournalRecord): string {
  return JSON.stringify(record) + "\n";
}

export function parseEventLine(line: string): Result<WorkflowEvent, WorkflowError> {
  return parseJson(line).andThen((value) =>
    isEventLike(value) ? ok(value) : err(corrupt("not a workflow event (missing string `type`)")),
  );
}

export function parseJournalLine(line: string): Result<JournalRecord, WorkflowError> {
  return parseJson(line).andThen((value) => {
    const result = journalRecordSchema.safeParse(value);
    if (!result.success)
      return err(corrupt("not a v2 journal record (expected started/result shape)"));
    // oxlint-disable-next-line typescript/consistent-type-assertions -- validated shape; branded strings are re-minted at this trusted disk boundary
    return ok(result.data as JournalRecord);
  });
}
