# Journal & resume

<p class="wf-eyebrow">packages/core/src/journal.ts</p>

A run persists each replayable call as append-only JSONL records. Every `agent()` call and
`askUserQuestion()` answer gets a `v2:` journal key derived from the call content, the previous
journal key, and replay-relevant options. Crash or kill a run, then resume it: completed prefix calls
return from disk in milliseconds and burn **zero model calls**.

<ResumeSimulator />

## How the cache hit works

The journal is keyed by content, not by sequence number. The runtime still assigns `seq` for events and
debugging, but replay uses the hash-chain key:

```js
key = sha256(kind, promptOrQuestion, previousKey, canonicalOpts)
```

The persisted file stores a `started` record when live work begins, then a `result` record when the
call finishes:

```json
{ "type": "started", "seq": 0, "journalKey": "v2:...", "agentKey": "0:Search:a" }
{ "type": "result", "seq": 0, "journalKey": "v2:...", "agentKey": "0:Search:a", "text": "..." }
```

Only `result` records replay. A dangling `started` means the call was in flight when the run stopped,
so resume treats it as a miss and runs it live.

## Resume rules

- **Same snapshot + args ⇒ 100% cache hit.** Nothing re-runs.
- **First miss cuts off replay.** Once a prompt, schema, model, isolation, adapter, agent type,
  instructions, or question identity changes, that call and every later call runs live.
- **Labels and phases are display state.** Rename a label or move a call to another phase and the
  journal key still matches.
- **Determinism is the precondition.** If your script branches on randomness or wall-clock time, it
  can build different calls and miss the journal. That's why the [sandbox](/guide/sandbox) bans those
  inputs outright.

Runs are stored under `~/.workflow/runs/{runId}/` as the event log + journal. That on-disk pair is the
source of truth that powers `defineworkflow watch`, `defineworkflow resume`, and `defineworkflow save`.
