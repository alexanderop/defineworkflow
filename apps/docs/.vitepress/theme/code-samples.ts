// Real excerpts from @workflow/core, used by the interactive widgets.
// Kept verbatim from the source so the docs never drift into hand-waving.

export const samples: Record<string, string> = {
  workflow: `import { agent, defineWorkflow, parallel, phase } from "defineworkflow"

export default defineWorkflow({
  name: "research-bugs",
  description: "Find bugs across the codebase, then verify each one",
  harness: "claude",
  phases: [{ title: "Find" }, { title: "Verify" }],

  async run() {
    phase("Find")
    const found = await agent("List suspicious files.", { schema: BUGS })

    phase("Verify")
    const checked = await parallel(
      found.bugs.map((b) => () =>
        agent("Is this real? " + b.desc, { schema: VERDICT })),
    )

    return checked.filter(Boolean).filter((v) => v.real)
  },
})`,

  seq: `const agent = async (prompt, opts = {}) => {
  const mySeq = seq++;                       // monotonic, per-runtime
  const phase = opts.phase ?? currentPhase;
  const label = opts.label ?? \`agent-\${mySeq}\`;
  const key = \`\${mySeq}:\${phase}:\${label}\`;`,

  queued: `  deps.emit({ type: "agent-queued", key, label, phase, prompt, at: deps.now() });`,

  abort: `  // A fired stop signal short-circuits before any work is scheduled.
  if (deps.signal?.aborted) {
    const e = { kind: "AdapterSpawn", adapter: "run", cause: "run stopped" };
    deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
    throw new WorkflowThrow(e);
  }`,

  journal: `  // Resume: a journal hit returns the cached result WITHOUT spawning a model.
  const cached = deps.journal.lookup(mySeq);
  if (cached) {
    budget.record(cached.outputTokens);
    deps.emit({ type: "agent-output", key, chunk: cached.text, at: deps.now() });
    deps.emit({ type: "agent-finished", key,
      usage: { inputTokens: 0, outputTokens: cached.outputTokens },
      cached: true, at: deps.now() });
    return cached.data ?? cached.text;
  }`,

  budget: `  // Soft gate — under concurrency, spend may overshoot. Not a reservation.
  if (deps.budgetTotal !== null && budget.remaining() <= 0) {
    const e = { kind: "BudgetExhausted", spent: budget.spent(), total: deps.budgetTotal };
    deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
    throw new WorkflowThrow(e);
  }`,

  cap: `  // Agent cap — claim the slot synchronously so concurrent launches can't overshoot.
  if (spawned >= deps.maxAgents) {
    const e = { kind: "AgentCapExceeded", cap: deps.maxAgents };
    deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
    throw new WorkflowThrow(e);
  }
  spawned++;`,

  schema: `  let jsonSchema;
  if (opts.schema) {
    const converted = toJsonSchema(opts.schema);   // zod → JSON Schema
    if (converted.isErr()) {
      const e = { kind: "SchemaValidation", issues: [...], attempts: 0 };
      deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
      throw new WorkflowThrow(e);
    }
    jsonSchema = converted.value;
  }`,

  pause: `  // Hold here while paused, then re-check stop (a pause may span a stop).
  if (deps.gate) await deps.gate();
  if (deps.signal?.aborted) { /* … emit agent-failed, throw … */ }`,

  acquire: `  const release = await deps.semaphore.acquire();   // ← blocks until a slot is free
  deps.emit({ type: "agent-started", key, at: deps.now() });
  try {
    const request = {
      prompt, label, cwd: deps.cwd,
      signal: deps.signal ?? new AbortController().signal,
      ...(jsonSchema ? { schema: jsonSchema } : {}),
      ...(opts.model ? { model: opts.model } : {}),
    };
    const result = await deps.runner.run(request, { runId: deps.runId, seq: mySeq });`,

  validate: `    const res = result.value;
    for (const tool of res.toolCalls) deps.emit({ type: "agent-tool", key, tool, ... });

    let value = res.text;
    if (opts.schema) {
      const validated = validate(opts.schema, res.data);  // zod re-checks the model
      if (validated.isErr()) { /* SchemaValidation, throw */ }
      value = validated.value;
    }`,

  record: `    budget.record(res.usage.outputTokens);
    deps.journal.record({ seq: mySeq, key, text: res.text,
      data: res.data, outputTokens: res.usage.outputTokens });   // ← future resumes hit this
    deps.emit({ type: "agent-output", key, chunk: res.text, at: deps.now() });
    deps.emit({ type: "agent-finished", key, usage: res.usage, cached: false, ... });
    return value;`,

  release: `  } finally {
    release();   // hand the semaphore slot to the next waiter — always runs
  }
};`,

  journalImpl: `export function createJournal(seed = []) {
  const bySeq = new Map();
  for (const e of seed) bySeq.set(e.seq, e);   // ← resume seeds from persisted JSONL
  return {
    lookup: (seq) => bySeq.get(seq),
    record: (entry) => { bySeq.set(entry.seq, entry); },
    entries: () => [...bySeq.values()].sort((a, b) => a.seq - b.seq),
  };
}`,

  semaphore: `export function createSemaphore(limit) {
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
}`,

  flow: `// BARRIER: awaits everything. A throw becomes null (never rejects the group).
const parallel = (thunks) =>
  Promise.all(thunks.map((t) => t().catch(() => null)));

// NO BARRIER: each item flows through all stages independently.
// Item A can be in stage 3 while item B is still in stage 1.
const pipeline = (items, ...stages) =>
  Promise.all(items.map(async (item, index) => {
    let prev = item;
    try { for (const s of stages) prev = await s(prev, item, index); return prev; }
    catch { return null; }   // a thrown stage drops THAT item, keeps the rest
  }));`,

  sandbox: `function makeBannedDate() {
  const Banned = function (...args) {
    if (args.length === 0)
      throw new Error("SandboxViolation: argless new Date() is not allowed");
    return new RealDate(...args);
  };
  Banned.now = () => { throw new Error("SandboxViolation: Date.now() is not allowed"); };
  return Banned;
}
const bannedMath = {
  ...Math,
  random: () => { throw new Error("SandboxViolation: Math.random() is not allowed"); },
};`,

  reduce: `case "agent-finished": {
  const a = state.agents.get(event.key);
  const tokens = event.usage.inputTokens + event.usage.outputTokens;
  agents.set(event.key, { ...a, status: "done", tokens });
  return { ...state, agents,
    totalTokens: state.totalTokens + tokens,
    phases: upsertPhase(state.phases, a.phase, (p) => ({
      ...p, done: p.done + 1,
      running: Math.max(0, p.running - (event.cached ? 0 : 1)),
      tokens: p.tokens + tokens })) };
}`,
};
