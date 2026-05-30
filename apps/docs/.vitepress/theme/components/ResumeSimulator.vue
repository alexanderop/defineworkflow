<script setup lang="ts">
import { ref, computed } from "vue";

type Agent = { seq: number; desc: string; cost: number };
const SIM: Agent[] = [
  { seq: 0, desc: "scan repo for smells", cost: 1200 },
  { seq: 1, desc: "rank by severity", cost: 800 },
  { seq: 2, desc: "verify bug #1", cost: 1500 },
  { seq: 3, desc: "verify bug #2", cost: 1500 },
  { seq: 4, desc: "synthesize report", cost: 2100 },
];
const TOTAL = SIM.reduce((a, b) => a + b.cost, 0);

const crash = ref(3); // entries journaled before the crash
const phase = ref<"idle" | "replaying" | "live" | "done">("idle");
const cursor = ref(-1);

const saved = computed(() => SIM.slice(0, crash.value).reduce((a, b) => a + b.cost, 0));
const savedPct = computed(() => Math.round((saved.value / TOTAL) * 100));
const running = computed(() => phase.value === "replaying" || phase.value === "live");

function rowState(seq: number): "cached" | "fresh" | "pending" | "static-cached" | "static-pending" {
  if (phase.value === "idle") return seq < crash.value ? "static-cached" : "static-pending";
  if (seq > cursor.value) return "pending";
  return seq < crash.value ? "cached" : "fresh";
}
function rowClass(seq: number) {
  const st = rowState(seq);
  if (st === "cached" || st === "static-cached") return "cached";
  if (st === "fresh") return "fresh";
  return "pending";
}
function badge(seq: number) {
  const st = rowState(seq);
  if (st === "cached" || st === "static-cached") return "journal hit";
  if (st === "fresh") return "spawning model";
  return "—";
}
function cost(a: Agent) {
  return rowState(a.seq) === "cached" ? "0 tok · cached" : a.cost + " tok";
}

function onCrash(e: Event) {
  crash.value = +(e.target as HTMLInputElement).value;
  phase.value = "idle";
  cursor.value = -1;
}

function run() {
  phase.value = "replaying";
  cursor.value = -1;
  let k = 0;
  const tick = () => {
    cursor.value = k;
    const journaled = k < crash.value;
    if (!journaled) phase.value = "live";
    k++;
    if (k > SIM.length) {
      phase.value = "done";
      return;
    }
    setTimeout(tick, journaled ? 180 : 950); // cached = instant, fresh = slow
  };
  setTimeout(tick, 180);
}
</script>

<template>
  <div class="sim">
    <div class="journal-rows">
      <div v-for="a in SIM" :key="a.seq" class="jrow" :class="rowClass(a.seq)">
        <span class="seq">seq {{ a.seq }}</span>
        <span class="desc">agent("{{ a.desc }}")</span>
        <span class="meta">
          <span class="cost">{{ cost(a) }}</span>
          <span class="badge">{{ badge(a.seq) }}</span>
        </span>
      </div>
    </div>

    <div class="card panel">
      <div class="wf-eyebrow">resume control</div>
      <label class="lbl">
        crash after seq: <b>{{ crash - 1 }}</b> ({{ crash }} entries journaled)
      </label>
      <input class="slider" type="range" min="0" max="5" :value="crash" @input="onCrash" />
      <div class="nums">
        <div>
          <div class="big save">{{ savedPct }}%</div>
          <div class="cap">replayed free</div>
        </div>
        <div class="r">
          <div class="big">{{ TOTAL - saved }}</div>
          <div class="cap">tokens still spent</div>
        </div>
      </div>
      <div class="meter"><div :style="{ width: savedPct + '%' }" /></div>
      <button class="btn primary" :disabled="running" @click="run">
        {{ running ? "resuming…" : "▶ defineworkflow resume <id>" }}
      </button>
      <p class="note">
        Same-session, same script + args ⇒ 100% cache hit. The first edited/new agent() call and
        everything after it runs live.
      </p>
    </div>
  </div>
</template>

<style scoped>
.sim {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 24px;
  margin: 26px 0;
  align-items: start;
}
.journal-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.jrow {
  display: grid;
  grid-template-columns: 54px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--wf-line);
  background: var(--wf-panel);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  transition: 0.3s;
}
.seq {
  color: var(--wf-ink-faint);
}
.desc {
  color: var(--wf-ink);
}
.meta {
  display: flex;
  gap: 10px;
  align-items: center;
}
.cost {
  color: var(--wf-ink-dim);
  font-size: 12px;
}
.badge {
  font-size: 11px;
  letter-spacing: 0.06em;
  padding: 3px 9px;
  border-radius: 20px;
  border: 1px solid var(--wf-line-bright);
  text-transform: uppercase;
  color: var(--wf-ink-faint);
}
.jrow.cached {
  border-color: rgba(103, 224, 138, 0.35);
  background: linear-gradient(90deg, rgba(103, 224, 138, 0.08), var(--wf-panel));
}
.jrow.cached .badge {
  color: var(--wf-green);
  border-color: rgba(103, 224, 138, 0.4);
}
.jrow.fresh {
  border-color: rgba(255, 176, 0, 0.4);
  background: linear-gradient(90deg, rgba(255, 176, 0, 0.1), var(--wf-panel));
}
.jrow.fresh .badge {
  color: var(--wf-amber);
  border-color: rgba(255, 176, 0, 0.45);
}
.jrow.pending {
  opacity: 0.4;
}
.card {
  background: var(--wf-panel);
  border: 1px solid var(--wf-line);
  border-radius: 14px;
}
.panel {
  padding: 20px;
  position: sticky;
  top: 96px;
}
.lbl {
  display: block;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--wf-ink-dim);
  margin-top: 14px;
}
.lbl b {
  color: var(--wf-amber);
}
.slider {
  width: 100%;
  accent-color: var(--wf-amber);
  margin: 12px 0 2px;
}
.nums {
  display: flex;
  justify-content: space-between;
  margin-top: 16px;
}
.nums .r {
  text-align: right;
}
.big {
  font-family: "Big Shoulders Display", sans-serif;
  font-weight: 900;
  font-size: 34px;
  color: var(--wf-ink);
  line-height: 1;
}
.big.save {
  color: var(--wf-green);
}
.cap {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--wf-ink-dim);
  margin-top: 4px;
}
.meter {
  height: 8px;
  border-radius: 6px;
  background: var(--wf-panel-2);
  overflow: hidden;
  margin: 8px 0 16px;
  border: 1px solid var(--wf-line);
}
.meter > div {
  height: 100%;
  background: linear-gradient(90deg, var(--wf-amber), var(--wf-amber-soft));
  transition: width 0.4s;
}
.btn.primary {
  width: 100%;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  cursor: pointer;
  background: var(--wf-amber);
  color: #100c00;
  border: 1px solid var(--wf-amber);
  font-weight: 600;
  padding: 10px 16px;
  border-radius: 9px;
}
.btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.note {
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: var(--wf-ink-faint);
  margin: 14px 0 0;
  line-height: 1.6;
}
@media (max-width: 760px) {
  .sim {
    grid-template-columns: 1fr;
  }
  .panel {
    position: static;
  }
}
</style>
