# CLI

<p class="wf-eyebrow">packages/cli — the <code>defineworkflow</code> binary</p>

`dispatch(argv, deps)` is a pure router over an injected `AppDeps`, which is what makes the whole CLI
testable. Runs are persisted under `~/.workflow/runs/{runId}/` as events + journal JSONL — the same
on-disk pair that powers `watch`, `resume`, and `save`.

## Commands

```bash
defineworkflow run <script> [--args '{...}'] [--detach] [--yes]
defineworkflow watch <id>            # attach the UI to a running/finished run
defineworkflow list                  # list runs (status, tokens, elapsed)
defineworkflow resume <id>           # replay the journal, run the rest live
defineworkflow stop <id>             # stop a backgrounded run
defineworkflow save <id>             # save a run's script as a named workflow
defineworkflow adapters              # list detected harnesses + capabilities
defineworkflow <name> [--args ...]   # run a saved/bundled workflow by name
```

## Running a workflow

```bash
# foreground — renders the Ink TUI with pause / stop / save controls
defineworkflow run ./research-bugs.workflow.ts --args '{ "dir": "src" }'

# detached — spawns a headless child you tail with `watch`
defineworkflow run ./research-bugs.workflow.ts --detach
defineworkflow watch <id>
```

## The consent gate

`consent.ts` gates execution before anything spawns. It uses `extractMeta()` (see the
[sandbox](/guide/sandbox)) to show the run's name and phases first:

- **Non-TTY / CI**, `--yes`, or a previously saved consent → auto-allow.
- **Interactive TTY** → prompt with the plan, then proceed on confirmation.

## Resume & save

`defineworkflow resume <id>` rebuilds the journal from disk and continues from the longest unchanged prefix —
see [Journal & resume](/guide/journal-resume). `defineworkflow save <id>` promotes a run's script to a named
workflow you can later invoke as `defineworkflow <name>`. The optional `whenToUse` meta hint, if set, is
shown alongside each entry in the saved/bundled workflow listing.

## Configuration

Config is layered: `~/.workflow/config.json` first, then `./.workflow/config.json`. Note that the
**harness is never overridable here** — it lives in `meta.harness` and nowhere else.
