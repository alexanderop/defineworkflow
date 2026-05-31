# The `agent()` lifecycle

<p class="wf-eyebrow">packages/core/src/runtime.ts</p>

This is the heart of the engine. Every `agent()` call walks the **same fixed 13-step sequence** — and
the order is load-bearing. The journal lookup happens *before* any model is spawned (that's resume),
the budget and agent-cap gates fail fast as values, and the semaphore slot is always released in a
`finally`. Click through each step; the panel shows the real code for that stage.

<LifecycleStepper />

## Why the order matters

A few invariants fall straight out of this sequence:

- **Journal-before-spawn** is the whole resume story. By the time control reaches the adapter, we've
  already proven this journal key has no cached result. See [Journal & resume](/guide/journal-resume).
- **Gates throw values, not exceptions.** Budget and agent-cap produce a tagged `WorkflowError`
  wrapped in `WorkflowThrow`, so your script body can `try/catch` it like any error while library code
  keeps threading `Result`.
- **`spawned++` is synchronous.** The cap is claimed the instant the check passes, so a burst of
  concurrent launches can't all slip past `maxAgents`.
- **`release()` lives in `finally`.** Success or throw, the [semaphore](/guide/concurrency) slot goes
  back to the next waiter. Omitting it would deadlock the run.

## The shape in one glance

<RoughDiagram
  direction="TB"
  caption="the fixed 13-step sequence every agent() call walks"
  :nodes="[
    { id: 's1', label: 'seq++' },
    { id: 's2', label: 'emit queued' },
    { id: 's3', label: 'check abort' },
    { id: 's4', label: 'zod→JSON Schema' },
    { id: 's5', label: 'journal lookup', sub: 'resume hit?', accent: 'cyan' },
    { id: 's6', label: 'budget gate', accent: 'amber' },
    { id: 's7', label: 'agent-cap gate', accent: 'amber' },
    { id: 's8', label: 'pause gate', accent: 'amber' },
    { id: 's9', label: 'acquire slot', accent: 'green' },
    { id: 's10', label: 'run adapter', accent: 'violet' },
    { id: 's11', label: 'validate' },
    { id: 's12', label: 'record' },
    { id: 's13', label: 'release', accent: 'green' },
  ]"
  :edges="[
    ['s1', 's2'], ['s2', 's3'], ['s3', 's4'], ['s4', 's5'], ['s5', 's6'],
    ['s6', 's7'], ['s7', 's8'], ['s8', 's9'], ['s9', 's10'], ['s10', 's11'],
    ['s11', 's12'], ['s12', 's13'],
  ]"
/>

Everything the runtime does is observable through [events](/guide/events) — there are no side channels.
