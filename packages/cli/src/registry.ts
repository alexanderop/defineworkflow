import { ok, err, type Result } from "neverthrow";
import { createJournal, type Journal, type JournalEntry, type WorkflowError, type WorkflowEvent } from "@workflow/core";
import type { AdapterId } from "@workflow/adapters";
import { serializeEvent, serializeJournalEntry, parseEventLine, parseJournalLine } from "./jsonl.js";

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
  readonly runId: string;
  readonly name: string;
  readonly scriptPath: string | null;
  readonly args: unknown;
  readonly adapter: AdapterId;
  readonly status: RunStatus;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly pid: number | null;
  readonly scriptHash: string;
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
  readMeta(runId: string): RunMeta | undefined;
  appendEvent(runId: string, event: WorkflowEvent): void;
  readEvents(runId: string): readonly WorkflowEvent[];
  readScript(runId: string): string | undefined;
  persistentJournal(runId: string, seed: readonly JournalEntry[]): Journal;
  readJournal(runId: string): Result<readonly JournalEntry[], WorkflowError>;
  listRuns(): readonly RunMeta[];
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

  const readMeta = (runId: string): RunMeta | undefined => {
    const raw = fs.readFile(metaPath(runId));
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as RunMeta;
    } catch {
      return undefined;
    }
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
        .filter((m): m is RunMeta => m !== undefined);
    },
  };
}
