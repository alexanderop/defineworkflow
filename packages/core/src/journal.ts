import { createHash } from "node:crypto";
import type { AgentKey, JournalKey } from "./brand.js";

export interface JournalStartedRecord {
  readonly type: "started";
  readonly seq: number;
  readonly journalKey: JournalKey;
  readonly agentKey: AgentKey | string;
}

export interface JournalResultRecord {
  readonly type: "result";
  readonly seq: number;
  readonly journalKey: JournalKey;
  readonly agentKey: AgentKey | string;
  readonly text: string;
  readonly data?: unknown;
  readonly outputTokens: number;
}

export type JournalRecord = JournalStartedRecord | JournalResultRecord;

export interface Journal {
  lookup(journalKey: JournalKey): JournalResultRecord | undefined;
  recordStarted(record: JournalStartedRecord): void;
  recordResult(record: JournalResultRecord): void;
  records(): readonly JournalRecord[];
}

export type JournalCallKind = "agent" | "question";

export interface JournalKeyInput {
  readonly kind: JournalCallKind;
  readonly prompt: string;
  readonly previousKey: JournalKey | null;
  readonly opts?: unknown;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b))) {
      if (v !== undefined) out[key] = stable(v);
    }
    return out;
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

export function computeJournalKey(input: JournalKeyInput): JournalKey {
  const hash = createHash("sha256")
    .update(input.kind)
    .update("\0")
    .update(input.prompt)
    .update("\0")
    .update(input.previousKey ?? "")
    .update("\0")
    .update(stableJson(input.opts ?? {}))
    .digest("hex");
  // oxlint-disable-next-line typescript/consistent-type-assertions -- brand mint: sha256 hex prefixed with v2 is the journal key
  return `v2:${hash}` as JournalKey;
}

export function createJournal(seed: readonly JournalRecord[] = []): Journal {
  const records: JournalRecord[] = [...seed];
  const resultsByKey = new Map<JournalKey, JournalResultRecord>();
  for (const record of records) {
    if (record.type === "result") resultsByKey.set(record.journalKey, record);
  }
  return {
    lookup: (journalKey) => resultsByKey.get(journalKey),
    recordStarted: (record) => {
      records.push(record);
    },
    recordResult: (record) => {
      records.push(record);
      resultsByKey.set(record.journalKey, record);
    },
    records: () => [...records],
  };
}
