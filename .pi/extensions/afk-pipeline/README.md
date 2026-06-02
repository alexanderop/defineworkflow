# AFK Pipeline Pi extension

Project-local Pi extension for running an AFK coding pipeline with a visible TUI control tower.

The extension follows Pi's native model:

```txt
parent Pi session = dashboard / manager
worker Pi sessions = fresh `pi -p` Ralph loops
parallelism = tmux sessions
isolation = git worktrees
```

Pi does not need built-in subagents for this. `/afk run` launches separate Pi processes and tracks them from the parent board.

## Requirements

- `pi` available on `PATH`
- `git`
- `tmux`
- a clean enough repo state to create worktrees/branches
- slice tickets with checkbox tasks, usually `docs/tickets/*.md`

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

## Commands

```txt
/afk start <spec>  # create a pipeline and ask Pi to begin spec/slice work
/afk board         # open the overlay dashboard
/afk status        # sync worker state, refresh widget, show summary
/afk run           # launch Pi-way Ralph workers for slice tickets
/afk sync          # refresh worker status from tmux/worktree state
/afk hide          # hide persistent widget
/afk show          # show persistent widget
/afk reset         # clear pipeline state for this Pi session
```

## Ralph mode: `/afk run`

`/afk run` looks for tickets in this order:

1. slice ticket paths already recorded on the AFK board
2. `docs/tickets/*.md`

For each ticket, it creates:

```txt
branch:       afk/<ticket-id>
worktree:     ../<repo-name>-afk-<ticket-id>
tmux session: pi-afk-<ticket-id>
worker file:  PROMPT.md
```

Each tmux worker runs repeated fresh Pi one-shots:

```bash
while grep -q '^- \[ \]' PROMPT.md; do
  pi --name "afk-<ticket-id>" -p @PROMPT.md "Use the afk-coding skill..."
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

## Inspect workers

List workers:

```bash
tmux ls | grep pi-afk
```

Attach to a worker:

```bash
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

## Stop a worker

```bash
tmux kill-session -t pi-afk-01-some-ticket
```

Then in the parent Pi session:

```txt
/afk sync
```

If the worker stopped with unchecked tasks still in `PROMPT.md`, the board marks that slice as blocked.

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

Once Pi creates `docs/tickets/*.md`, launch Ralph workers:

```txt
/afk run
```

Open the dashboard:

```txt
/afk board
```

## Safety notes

- Workers are real Pi processes with normal tool access.
- They run in git worktrees, not the main checkout.
- They can still execute shell commands, so review tickets before launching.
- Prefer small vertical tickets. Do not run twenty workers just because you can.
- Human review is still required before merging worker branches.
