<script setup lang="ts">
import { ref, computed } from "vue";
import CodeBlock from "./CodeBlock.vue";
import { samples } from "../code-samples";

type Tag = { kind: "" | "key" | "warn" | "ok"; text: string };
type Step = { t: string; code: keyof typeof samples; title: string; tag: Tag; body: string };

const STEPS: Step[] = [
  { t: "Assign a sequence number", code: "seq", title: "seq++ — the replay key",
    tag: { kind: "key", text: "this number is everything" },
    body: "Every agent() call grabs a monotonic seq from the runtime. It's the primary key in the journal — the entire resume mechanism keys off it. Same script + same args ⇒ identical seq order, which is exactly why scripts must be deterministic." },
  { t: "Emit agent-queued", code: "queued", title: "Become observable",
    tag: { kind: "ok", text: "the UI is built from events" },
    body: "Before doing any work, the runtime emits a typed event. The UI and the persisted registry are pure functions of this event stream — there are no side channels. reduce(state, event) rebuilds RunState." },
  { t: "Check the stop signal", code: "abort", title: "Fail fast on stop",
    tag: { kind: "warn", text: "run-scoped AbortSignal" },
    body: "A fired stop short-circuits before scheduling work. Errors are values here: it throws a WorkflowThrow wrapping a tagged WorkflowError, which author code can catch like a normal exception." },
  { t: "Journal lookup (resume!)", code: "journal", title: "The cache that makes resume free",
    tag: { kind: "key", text: "return BEFORE spawning a model" },
    body: "If this seq is already in the journal, return the cached result immediately — no model call. On a fresh run the journal is empty; on resume it's seeded from persisted JSONL, so everything up to the crash point flashes back instantly." },
  { t: "Budget gate", code: "budget", title: "A soft ceiling, not a reservation",
    tag: { kind: "", text: "may overshoot under concurrency" },
    body: "If a token budget is set and it's spent, throw BudgetExhausted. It's best-effort: several concurrent agents can read remaining() before any of them records, so spend can overshoot total. remaining() is Infinity when no cap is set." },
  { t: "Agent-cap gate", code: "cap", title: "Claim the slot synchronously",
    tag: { kind: "", text: "runaway backstop" },
    body: "spawned++ happens synchronously the instant the cap check passes, so concurrent launches can't race past maxAgents. It's a far-above-normal backstop against an infinite loop spawning agents forever." },
  { t: "Convert zod → JSON Schema", code: "schema", title: "Schema in, structured out",
    tag: { kind: "ok", text: "@workflow/schema only" },
    body: "If you passed a zod schema, it's converted to JSON Schema now (the only place that touches z.toJSONSchema). Conversion failure is itself a value: SchemaValidation with attempts:0. The JSON Schema rides along in the AgentRequest." },
  { t: "Pause gate, re-check stop", code: "pause", title: "Hold here while paused",
    tag: { kind: "", text: "pause may span a stop" },
    body: "The pause gate awaits before acquiring a slot — resolving instantly when not paused. After it resolves, stop is re-checked, because a long pause might have outlived the run." },
  { t: "Acquire a semaphore slot", code: "acquire", title: "Concurrency throttle",
    tag: { kind: "key", text: "blocks until a slot frees" },
    body: "This is where real concurrency is enforced. await semaphore.acquire() blocks until one of the N slots is free. Only after acquiring does agent-started fire and the AgentRequest get built and handed to the adapter's runner.run()." },
  { t: "Validate the model output", code: "validate", title: "Trust, then verify",
    tag: { kind: "", text: "zod re-checks" },
    body: "Tool calls are emitted as events. If a schema was supplied, the model's parsed data is validated again with zod — a mismatch is SchemaValidation with attempts:1, thrown as a value. Without a schema, the raw text is the return value." },
  { t: "Record to the journal", code: "record", title: "Make the future replay free",
    tag: { kind: "key", text: "the durability write" },
    body: "Output tokens are recorded against budget, then the result is written to the journal keyed by seq. THIS is the entry a future resume will hit. Then agent-output and agent-finished (cached:false) fire and the validated value returns." },
  { t: "Release the slot — always", code: "release", title: "finally { release() }",
    tag: { kind: "ok", text: "hands off to the next waiter" },
    body: "In a finally, the semaphore slot is released whether the agent succeeded or threw, waking the longest-waiting queued agent. Forgetting this would deadlock the whole run, which is why it lives in finally." },
];

const i = ref(0);
const s = computed(() => STEPS[i.value]);
const tagClass = computed(() => "tag " + s.value.tag.kind);
const fn = computed(() => `runtime.ts · agent()  →  step ${i.value + 1}/${STEPS.length}`);
</script>

<template>
  <div class="stepper">
    <div class="steps-list">
      <button
        v-for="(st, k) in STEPS"
        :key="k"
        class="step-btn"
        :class="{ active: k === i }"
        @click="i = k"
      >
        <span class="num">{{ k + 1 }}</span>
        <span class="t">{{ st.t }}</span>
      </button>
    </div>

    <div class="step-detail">
      <div class="card step-explain">
        <h3>{{ s.title }}</h3>
        <p>{{ s.body }}</p>
        <span :class="tagClass">{{ s.tag.text }}</span>
      </div>
      <CodeBlock :code="samples[s.code]" :fn="fn" />
      <div class="stepnav">
        <button class="btn" :disabled="i === 0" @click="i = Math.max(0, i - 1)">← prev</button>
        <button
          class="btn primary"
          :disabled="i === STEPS.length - 1"
          @click="i = Math.min(STEPS.length - 1, i + 1)"
        >
          next step →
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stepper {
  display: grid;
  grid-template-columns: 290px 1fr;
  gap: 24px;
  margin: 26px 0;
}
.steps-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 560px;
  overflow: auto;
  padding-right: 4px;
}
.step-btn {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  text-align: left;
  width: 100%;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 9px 11px;
  color: var(--wf-ink-dim);
  transition: 0.14s;
  font-family: var(--vp-font-family-mono);
}
.step-btn:hover {
  background: var(--wf-panel);
}
.step-btn .num {
  flex: 0 0 26px;
  height: 26px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--wf-panel-2);
  border: 1px solid var(--wf-line-bright);
  color: var(--wf-ink-dim);
}
.step-btn .t {
  font-size: 13px;
  line-height: 1.4;
  padding-top: 3px;
}
.step-btn.active {
  background: linear-gradient(90deg, rgba(255, 176, 0, 0.12), transparent);
  border-color: var(--wf-line-bright);
  color: var(--wf-ink);
}
.step-btn.active .num {
  background: var(--wf-amber);
  color: #100c00;
  border-color: var(--wf-amber);
  box-shadow: 0 0 14px rgba(255, 176, 0, 0.4);
}
.step-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.card {
  background: var(--wf-panel);
  border: 1px solid var(--wf-line);
  border-radius: 14px;
}
.step-explain {
  padding: 18px 20px;
}
.step-explain h3 {
  font-size: 23px;
  color: var(--wf-ink);
  margin: 0 0 8px;
  font-family: "Big Shoulders Display", sans-serif;
  font-weight: 900;
}
.step-explain p {
  margin: 0;
  color: var(--wf-ink-dim);
  font-size: 15.5px;
  font-family: var(--vp-font-family-base);
}
.tag {
  display: inline-block;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  padding: 3px 9px;
  border-radius: 5px;
  border: 1px solid var(--wf-line-bright);
  color: var(--wf-cyan);
  margin-top: 12px;
  text-transform: uppercase;
}
.tag.warn {
  color: var(--wf-red);
}
.tag.key {
  color: var(--wf-amber);
}
.tag.ok {
  color: var(--wf-green);
}
.stepnav {
  display: flex;
  gap: 10px;
}
.btn {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--wf-line-bright);
  background: var(--wf-panel);
  color: var(--wf-ink);
  padding: 9px 16px;
  border-radius: 9px;
  transition: 0.14s;
}
.btn:hover {
  border-color: var(--wf-amber);
  color: var(--wf-amber);
}
.btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.btn.primary {
  background: var(--wf-amber);
  color: #100c00;
  border-color: var(--wf-amber);
  font-weight: 600;
}
@media (max-width: 760px) {
  .stepper {
    grid-template-columns: 1fr;
  }
}
</style>
