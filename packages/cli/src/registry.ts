import { z } from "zod";
import { ok, err, type Result } from "neverthrow";
import { createJournal, type Immutable, type JsonValue, type Journal, type JournalEntry, type RunId, type Tagged, type WorkflowError, type WorkflowEvent } from "@workflow/core";
import type { AdapterId } from "@workflow/adapters";
import { serializeEvent, serializeJournalEntry, parseEventLine, parseJournalLine } from "./jsonl.js";

/** SHA-256 hex of a run's script snapshot — compared on resume to guarantee same-script replay. */
export type ScriptHash = Tagged<string, "ScriptHash">;

/**
 * The persisted meta.json shape, validated when read back. Branded fields (`runId`/`scriptHash`)
 * and `adapter` are stored as plain strings on disk; `safeParse` proves the structure, then the
 * brands are re-minted in one cast at this trusted boundary — the only thing JSON can't carry.
 */
/** Recursive validator for arbitrary persisted JSON — proves `args` really is a `JsonValue` rather
 * than asserting it through `z.unknown()`, so `RunMeta.args: Immutable<JsonValue>` is earned. */
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

const runMetaSchema = z.object({
  runId: z.string(),
  name: z.string(),
  scriptPath: z.string().nullable(),
  args: jsonValueSchema,
  adapter: z.enum(["claude", "codex", "copilot", "raw-api"]),
  status: z.enum(["running", "finished", "failed", "stopped"]),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  pid: z.number().nullable(),
  scriptHash: z.string(),
  answers: z.record(z.string(), z.string()).optional(),
});

export interface RegistryFs {
  mkdirp(dir: string): void;
  writeFile(path: string, data: string): void;
  appendFile(path: string, data: string): void;
  readFile(path: string): string | undefined;
  readDir(dir: string): readonly string[];
  exists(path: string): boolean;
}

export type RunStatus = "running" | "finished" | "failed" | "stopped";

export interface RunMeta {
  readonly runId: RunId;
  readonly name: string;
  readonly scriptPath: string | null;
  readonly args: Immutable<JsonValue>;
  readonly adapter: AdapterId;
  readonly status: RunStatus;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly pid: number | null;
  readonly scriptHash: ScriptHash;
  /** Pre-supplied answers for askUserQuestion() (from `--answers`); read by detached/headless runs. */
  readonly answers?: Readonly<Record<string, string>>;
}

export interface RegistryDeps {
  readonly root: string;
  readonly fs: RegistryFs;
}

export interface Registry {
  runDir(runId: string): string;
  init(meta: RunMeta, scriptSource: string): void;
  updateMeta(runId: string, patch: Partial<RunMeta>): void;
  readMeta(runId: string): Immutable<RunMeta> | undefined;
  appendEvent(runId: string, event: WorkflowEvent): void;
  readEvents(runId: string): readonly WorkflowEvent[];
  readScript(runId: string): string | undefined;
  persistentJournal(runId: string, seed: readonly JournalEntry[]): Journal;
  readJournal(runId: string): Result<readonly JournalEntry[], WorkflowError>;
  listRuns(): readonly Immutable<RunMeta>[];
}

function nonEmptyLines(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw.split("\n").filter((l) => l.trim() !== "");
}

export function createRegistry(deps: RegistryDeps): Registry {
  const { fs, root } = deps;
  const runDir = (runId: string): string => `${root}/${runId}`;
  const metaPath = (runId: string): string => `${runDir(runId)}/meta.json`;
  const eventsPath = (runId: string): string => `${runDir(runId)}/events.jsonl`;
  const journalPath = (runId: string): string => `${runDir(runId)}/journal.jsonl`;
  const scriptPath = (runId: string): string => `${runDir(runId)}/script.snapshot`;

  const readMeta = (runId: string): Immutable<RunMeta> | undefined => {
    const raw = fs.readFile(metaPath(runId));
    if (raw === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    const result = runMetaSchema.safeParse(parsed);
    if (!result.success) return undefined;
    // oxlint-disable-next-line typescript/consistent-type-assertions -- validated shape; re-mint RunId/ScriptHash brands at this trusted disk boundary
    return result.data as unknown as Immutable<RunMeta>;
  };

  return {
    runDir,
    init(meta, scriptSource) {
      fs.mkdirp(runDir(meta.runId));
      fs.writeFile(metaPath(meta.runId), JSON.stringify(meta, null, 2));
      fs.writeFile(scriptPath(meta.runId), scriptSource);
    },
    updateMeta(runId, patch) {
      const current = readMeta(runId);
      if (!current) return;
      fs.writeFile(metaPath(runId), JSON.stringify({ ...current, ...patch }, null, 2));
    },
    readMeta,
    appendEvent(runId, event) {
      fs.appendFile(eventsPath(runId), serializeEvent(event));
    },
    readEvents(runId) {
      // Best-effort for display: skip lines that fail to parse.
      const out: WorkflowEvent[] = [];
      for (const line of nonEmptyLines(fs.readFile(eventsPath(runId)))) {
        const parsed = parseEventLine(line);
        if (parsed.isOk()) out.push(parsed.value);
      }
      return out;
    },
    readScript: (runId) => fs.readFile(scriptPath(runId)),
    persistentJournal(runId, seed) {
      const journal = createJournal(seed);
      return {
        lookup: journal.lookup,
        entries: journal.entries,
        record: (entry) => {
          journal.record(entry);
          fs.appendFile(journalPath(runId), serializeJournalEntry(entry));
        },
      };
    },
    readJournal(runId) {
      const entries: JournalEntry[] = [];
      for (const line of nonEmptyLines(fs.readFile(journalPath(runId)))) {
        const parsed = parseJournalLine(line);
        if (parsed.isErr()) return err(parsed.error);
        entries.push(parsed.value);
      }
      return ok(entries);
    },
    listRuns() {
      return fs
        .readDir(root)
        .map((id) => readMeta(id))
        .filter((m): m is Immutable<RunMeta> => m !== undefined);
    },
  };
}
