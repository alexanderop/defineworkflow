# AFK Pipeline Pi extension

Project-local Pi extension for running an AFK coding pipeline with a visible TUI control tower.

The extension follows Pi's native model:

```txt
parent Pi session = dashboard / manager
worker Pi sessions = fresh `pi -p` Ralph loops
feedback = `/afk logs <slice>` plus tmux attach
parallelism = tmux sessions
isolation = optional git worktrees (`/afk run --worktree`)
```

Pi does not need built-in subagents for this. `/afk run` launches separate Pi processes and tracks them from the parent board.

## Requirements

- `pi` available on `PATH`
- `git`
- `tmux`
- slice tickets with checkbox tasks, usually `docs/tickets/*.md`
- optional: a clean enough repo state to create worktrees/branches if you use `/afk run --worktree`

## Start a pipeline

From the repo root:

```bash
pi
```

Then start from a spec/PRD:

```txt
/afk start docs/prd-convert-workflow-to-rust.md
```

Pi will read the spec, validate whether it is clear enough, and slice it into vertical tickets. The companion skill is at:

```txt
.agents/skills/afk-coding/SKILL.md
```

A common loop is:

```txt
/afk start docs/my-spec.md       # spec + slicing
/afk board                       # inspect slices
/afk run --only 01-first-slice   # run one in-place Ralph worker
/afk logs 01-first-slice         # watch feedback
/afk sync                        # refresh board when it stops
/afk qa                          # produce QA report
/afk review                      # prepare human review
```

## Commands

```txt
/afk start <spec>              # create a pipeline and ask Pi to begin spec/slice work
/afk doctor                    # check pi/git/tmux, optional worktree support, spec, and tickets
/afk board                     # open the overlay dashboard
/afk status                    # sync worker state, refresh widget, show summary
/afk run [--only id]           # launch one in-place Ralph worker in the current checkout
/afk run --worktree --max N     # launch parallel isolated worktree workers
/afk run --only 01-auth --yes   # skip confirmation for a specific ticket
/afk logs [id]                 # quick feedback: show worker summary + latest log/tmux output
/afk feedback [id]             # alias for /afk logs
/afk sync                      # refresh worker status from tmux/prompt/log state
/afk qa                        # start the QA phase and prompt for a QA report
/afk review                    # start the human-review summary phase
/afk integrate                 # prepare a safe integration plan from worker branches
/afk pr                        # draft a PR summary/checklist
/afk hide                      # hide persistent widget
/afk show                      # show persistent widget
/afk reset                     # clear pipeline state for this Pi session
```

## Ralph mode: `/afk run`

`/afk run` looks for tickets in this order:

1. slice ticket paths already recorded on the AFK board
2. `docs/tickets/*.md`

By default, `/afk run` launches **one in-place worker in the current checkout** and asks for confirmation before doing so. This avoids worktrees entirely, but intentionally caps concurrency at one so workers do not fight over the same files. Use `--only <ticket-id>` to target a ticket and `--yes` when you already reviewed the launch plan.

For the default in-place mode, it creates:

```txt
tmux session: pi-afk-<ticket-id>
worker file:  .pi/afk/prompts/<ticket-id>.md
worker log:   .pi/afk/logs/<ticket-id>.log
```

If you want parallel isolation, use `/afk run --worktree --max N`. In worktree mode it also creates:

```txt
branch:       afk/<ticket-id>
worktree:     ../<repo-name>-afk-<ticket-id>
```

Each tmux worker runs repeated fresh Pi one-shots:

```bash
while grep -q '^- \[ \]' "$PROMPT_FILE"; do
  pi --name "afk-<ticket-id>" -p @"$PROMPT_FILE" "Use the afk-coding skill..."
done
```

The worker instruction is intentionally Ralph-shaped:

1. pick exactly one unchecked task
2. red: write/update the failing test
3. green: implement the smallest passing change
4. refactor while tests stay green
5. run relevant checks
6. commit
7. tick the checkbox
8. exit so the next loop starts with fresh context

If blocked, workers are instructed to add this structured section to their prompt file and exit non-zero:

```md
## Blocked

Reason:
Needed human decision:
Files touched:
Suggested next step:
```

## Feedback and inspection

Fast path from inside Pi:

```txt
/afk logs              # active worker, or first slice
/afk logs 01-auth      # specific slice
/afk feedback 01-auth  # alias
```

This shows the slice summary, prompt path, log path, and the latest worker log lines. If no log file exists yet, it falls back to `tmux capture-pane`.

Manual tmux inspection still works:

```bash
tmux ls | grep pi-afk
tmux attach -t pi-afk-01-some-ticket
```

Detach from tmux:

```txt
Ctrl-b d
```

Refresh the parent board after workers finish or stop:

```txt
/afk sync
```

Sync updates the board with task progress, latest commit hash, blocker notes, stale-worker warnings, and copies the worker prompt back over the parent ticket when a worker has stopped.

## Stop a worker

```bash
tmux kill-session -t pi-afk-01-some-ticket
```

Then in the parent Pi session:

```txt
/afk sync
```

If the worker stopped with unchecked tasks still in its prompt file, the board marks that slice as blocked.

## Registered model tools

The extension registers these tools so the model can keep the board accurate:

- `afk_set_phase` — update current phase/status
- `afk_update_slice` — create/update a vertical slice
- `afk_record_artifact` — record spec, ticket, branch, QA report, PR URL, etc.
- `afk_mark_blocked` — mark the pipeline or a slice blocked before asking the user

The system prompt is augmented while a pipeline is active so Pi knows to call these tools.

## Example for this repo

An example migration spec exists at:

```txt
docs/prd-convert-workflow-to-rust.md
```

Kick it off:

```txt
/afk start docs/prd-convert-workflow-to-rust.md
```

Once Pi creates `docs/tickets/*.md`, launch a Ralph worker in-place:

```txt
/afk run --only 01-some-ticket
```

Get feedback while it runs:

```txt
/afk logs 01-some-ticket
```

Open the dashboard:

```txt
/afk board
```

## Safety notes

- Workers are real Pi processes with normal tool access.
- By default, they run in the current checkout, so keep only one in-place worker active.
- Use `/afk run --worktree --max N` if you want parallel isolated workers.
- Workers can execute shell commands, so review tickets before launching.
- Run `/afk doctor` before large launches.
- Prefer small vertical tickets and keep concurrency low.
- Human review is still required before merging worker branches; `/afk integrate` and `/afk pr` prepare plans/summaries rather than blindly merging.
