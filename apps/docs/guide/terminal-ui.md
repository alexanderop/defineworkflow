# The terminal UI

Every foreground run renders a live [Ink](https://github.com/vadimdemedes/ink) dashboard: a header,
then a three-pane layout of **phases**, **agents**, and a **detail** view, with a contextual footer of
key hints. It is driven entirely by the engine's typed [event stream](/guide/events) — the same events
are reduced into `RunState`, and the panes are pure functions of that state.

Press **▶ run** below to watch a real workflow play out. This is a fabricated `--mock` run — the exact
event stream and `reduce()` the terminal renders from, only running in your browser instead of a TTY.
Click any phase or agent to inspect it; use the speed control to slow it down or fast-forward.

<WorkflowTui />

## What you're seeing

This mirrors the `feature-pipeline` example: a feature is driven from **PRD → Decompose →
(TDD → Review → Refactor per subtask) → Integrate → Cleanup**. The build stage uses
[`pipeline()`](/guide/parallel-pipeline), so each subtask flows through its three stages
**independently** — watch `refill-clock` reach Review while `token-bucket-core` is still refactoring.
No barrier between stages; the [semaphore](/guide/concurrency) caps how many run at once.

- **Header** — workflow name, `done/total` agents, elapsed wall-clock, and the active adapter (`mock` here).
- **Phases** — a spinner while any agent in the phase is running, a green `✓` once they all complete,
  and a live `done/total` count.
- **Agents** — one row per `agent()` call: status glyph, label, and glanceable metrics
  (tokens · tool calls · elapsed). The view follows the live run and re-anchors on the running agent.
- **Detail** — the selected agent's status, model, prompt, recent tool activity, and outcome.

## Try it yourself, token-free

The widget above is powered by `createMockRunner`, the same fabricating backend behind the CLI's
`--mock` flag. Point it at any workflow to iterate on control flow, phases, and the UI with **no agents
spawned and no tokens spent**:

```bash
defineworkflow run packages/examples/src/feature-pipeline.workflow.ts --mock
```

Every `agent()` call returns schema-valid dummy data after a short artificial delay (so concurrency and
the animation are observable), the consent gate is skipped, and the declared harness need not be
installed. It always runs in the foreground so you get the full Ink dashboard.

See [Events & RunState](/guide/events) for how the stream reduces into the state these panes render, and
[parallel() vs pipeline()](/guide/parallel-pipeline) for the interleaving you see in the build stage.
