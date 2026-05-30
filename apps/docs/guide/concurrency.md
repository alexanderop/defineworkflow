# Concurrency & the semaphore

<p class="wf-eyebrow">packages/core/src/semaphore.ts</p>

You can hand `parallel()` a hundred thunks — only **N** run at once. A tiny counting semaphore hands
out slots; the rest queue and wake in FIFO order as slots free in a `finally`. Set the limit, run the
agents, and watch the slots fill and the queue drain.

<SemaphoreViz />

## The whole implementation

There's no magic here — it's ~20 lines. `acquire()` either takes a free slot or parks a resolver on
the `waiters` queue; `release()` hands the slot to the longest-waiting agent.

```js
export function createSemaphore(limit) {
  let available = limit;
  const waiters = [];
  const release = () => {
    available++;
    const next = waiters.shift();
    if (next) { available--; next(); }      // wake the longest-waiting agent
  };
  return {
    acquire: () => new Promise((resolve) => {
      if (available > 0) { available--; resolve(release); }
      else waiters.push(() => resolve(release));
    }),
  };
}
```

## Two different limits

Don't conflate these:

- **Concurrency** (the semaphore) — how many agents run *simultaneously*. Default `min(16, cores − 2)`.
  This is the throttle the visualizer above models.
- **Agent cap** (`maxAgents`) — the *total* number of agents a run may ever spawn. A far-above-normal
  runaway backstop, checked at [step 5](/guide/agent-lifecycle) and claimed synchronously with
  `spawned++`.

The slot is acquired at step 9 of the lifecycle and released at step 11 — inside a `finally`, so a
failing agent never strands its slot.
