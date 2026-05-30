# Journal & resume

<p class="wf-eyebrow">packages/core/src/journal.ts</p>

A run persists every agent result as JSONL, keyed by its sequence number. Crash, kill, or
edit-and-rerun: the longest unchanged prefix replays from disk in milliseconds and burns **zero model
calls**. Drag the crash point below and hit resume — journaled entries (green) flash back instantly;
only the fresh ones (amber) spawn a model.

<ResumeSimulator />

## How the cache hit works

The journal is a `Map<seq, entry>`. On a fresh run it starts empty; on resume it's **seeded from the
persisted JSONL**, so `lookup(seq)` returns a hit for everything that completed before the crash. Step
4 of the [agent lifecycle](/guide/agent-lifecycle) returns that cached value immediately, before any
adapter is touched.

```js
export function createJournal(seed = []) {
  const bySeq = new Map();
  for (const e of seed) bySeq.set(e.seq, e);   // ← resume seeds from persisted JSONL
  return {
    lookup: (seq) => bySeq.get(seq),
    record: (entry) => { bySeq.set(entry.seq, entry); },
    entries: () => [...bySeq.values()].sort((a, b) => a.seq - b.seq),
  };
}
```

## Resume rules

- **Same session, same script + args ⇒ 100% cache hit.** Nothing re-runs.
- **Editing the script** invalidates from the first changed `agent()` call onward — that call and
  everything after it runs live, because their recorded results no longer match.
- **Determinism is the precondition.** If your script branched on `Math.random()` or wall-clock time,
  the seq order would differ on replay and the journal would line up against the wrong calls. That's
  why the [sandbox](/guide/sandbox) bans those outright.

Runs are stored under `~/.workflow/runs/{runId}/` as the event log + journal. That on-disk pair is the
source of truth that powers `defineworkflow watch`, `defineworkflow resume`, and `defineworkflow save`.
