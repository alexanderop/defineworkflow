# `parallel()` vs `pipeline()`

<p class="wf-eyebrow">packages/core/src/runtime.ts</p>

Both run work concurrently — the difference is the **barrier**. `parallel()` awaits *everything*
before returning. `pipeline()` has no barrier: each item flows through all stages independently, so
item A can be in stage 2 while item B is still in stage 1. Toggle below and watch the wall-clock.

<ParallelPipeline />

## What you're seeing

In **parallel-then-parallel** (two `parallel()` calls in sequence), stage 2 can't begin until the
slowest stage-1 finishes — that red line is the barrier, and fast items sit idle against it. In
**`pipeline()`**, each item's stage 2 starts the moment *its own* stage 1 is done. Wall-clock becomes
the slowest single chain instead of the sum of slowest-per-stage.

<RoughDiagram
  direction="LR"
  caption="parallel(): every stage-1 thunk must clear the barrier before any stage-2 begins"
  :nodes="[
    { id: 'pa1', label: 'A: stage1', accent: 'amber' },
    { id: 'pb1', label: 'B: stage1', accent: 'amber' },
    { id: 'pc1', label: 'C: stage1', accent: 'amber' },
    { id: 'bar', label: 'await all', sub: 'barrier', accent: 'red', shape: 'ellipse' },
    { id: 'pa2', label: 'A: stage2', accent: 'amber' },
    { id: 'pb2', label: 'B: stage2', accent: 'amber' },
    { id: 'pc2', label: 'C: stage2', accent: 'amber' },
  ]"
  :edges="[
    ['pa1', 'bar'], ['pb1', 'bar'], ['pc1', 'bar'],
    ['bar', 'pa2'], ['bar', 'pb2'], ['bar', 'pc2'],
  ]"
/>

<RoughDiagram
  direction="LR"
  caption="pipeline(): no barrier — A can be in stage2 while C is still in stage1"
  :nodes="[
    { id: 'qa1', label: 'A: stage1', accent: 'cyan' },
    { id: 'qa2', label: 'A: stage2', accent: 'cyan' },
    { id: 'qb1', label: 'B: stage1', accent: 'cyan' },
    { id: 'qb2', label: 'B: stage2', accent: 'cyan' },
    { id: 'qc1', label: 'C: stage1', accent: 'cyan' },
    { id: 'qc2', label: 'C: stage2', accent: 'cyan' },
  ]"
  :edges="[
    ['qa1', 'qa2'], ['qb1', 'qb2'], ['qc1', 'qc2'],
  ]"
/>

```js
// BARRIER: awaits everything. A throw becomes null (never rejects the group).
const parallel = (thunks) =>
  Promise.all(thunks.map((t) => t().catch(() => null)));

// NO BARRIER: each item flows through all stages independently.
const pipeline = (items, ...stages) =>
  Promise.all(items.map(async (item, index) => {
    let prev = item;
    try { for (const s of stages) prev = await s(prev, item, index); return prev; }
    catch { return null; }   // a thrown stage drops THAT item, keeps the rest
  }));
```

## When to reach for which

- **Default to `pipeline()`.** Most multi-stage work (find → verify, draft → critique) has no
  cross-item dependency, so a barrier just wastes the fast items' time.
- **Reach for a barrier (`parallel()`) only when stage N genuinely needs *all* of stage N−1** — e.g.
  dedup/merge across the full result set, or an early-exit on a zero count.
- **Both swallow failures into `null`.** Filter with `.filter(Boolean)` before using the results.

Every concurrent branch still passes through the [semaphore](/guide/concurrency), so "100 thunks"
never means "100 agents at once."
