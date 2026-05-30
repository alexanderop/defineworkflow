<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from "vue";

type State = "queue" | "run" | "done";
const N = 7;
const limit = ref(3);
const agents = ref<{ id: number; state: State }[]>([]);
let timer: ReturnType<typeof setInterval> | null = null;

function reset() {
  if (timer) clearInterval(timer);
  timer = null;
  agents.value = Array.from({ length: N }, (_, k): { id: number; state: State } => ({ id: k, state: "queue" }));
}
reset();
watch(limit, reset);
onUnmounted(() => timer && clearInterval(timer));

const busy = computed(() => agents.value.filter((a) => a.state === "run").length);

function play() {
  reset();
  setTimeout(() => {
    timer = setInterval(() => {
      const next = agents.value.map((a) => ({ ...a }));
      const runningNow = next.filter((a) => a.state === "run");
      // finish ~half the running agents this tick
      runningNow.slice(0, Math.ceil(runningNow.length / 2)).forEach((a) => {
        next[a.id].state = "done";
      });
      // fill freed slots from the queue (FIFO)
      let free = limit.value - next.filter((a) => a.state === "run").length;
      for (let k = 0; k < next.length && free > 0; k++) {
        if (next[k].state === "queue") {
          next[k].state = "run";
          free--;
        }
      }
      agents.value = next;
      if (next.every((a) => a.state === "done") && timer) {
        clearInterval(timer);
        timer = null;
      }
    }, 850);
  }, 80);
}
</script>

<template>
  <div class="sema">
    <div>
      <div class="cap">slots — {{ busy }}/{{ limit }} busy</div>
      <div class="slots">
        <div v-for="k in limit" :key="k" class="slot" :class="{ busy: k <= busy }">
          {{ k <= busy ? "▶ run" : "free" }}
        </div>
      </div>
      <div class="cap mt">agents</div>
      <div class="chips">
        <span
          v-for="a in agents"
          :key="a.id"
          class="chip"
          :class="a.state"
        >
          agent-{{ a.id }} {{ a.state === "queue" ? "·waiting" : a.state === "run" ? "·running" : "·done" }}
        </span>
      </div>
    </div>

    <div class="card panel">
      <div class="wf-eyebrow">concurrency</div>
      <label class="lbl">limit = <b>{{ limit }}</b></label>
      <input class="slider" type="range" min="1" max="5" :value="limit" @input="limit = +($event.target as HTMLInputElement).value" />
      <button class="btn primary" @click="play">▶ run {{ N }} agents</button>
      <button class="btn ghost" @click="reset">reset</button>
      <p class="note">
        Default cap = min(16, cores − 2). The total-agents-per-run cap is a separate runaway backstop.
      </p>
    </div>
  </div>
</template>

<style scoped>
.sema {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 24px;
  margin: 26px 0;
  align-items: start;
}
.cap {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--wf-ink-dim);
  margin-bottom: 10px;
}
.cap.mt {
  margin-top: 18px;
}
.slots {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.slot {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  border: 1px dashed var(--wf-line-bright);
  display: grid;
  place-items: center;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--wf-ink-faint);
  transition: 0.2s;
}
.slot.busy {
  border-style: solid;
  border-color: var(--wf-amber);
  background: rgba(255, 176, 0, 0.12);
  color: var(--wf-amber);
  box-shadow: 0 0 16px rgba(255, 176, 0, 0.2);
}
.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.chip {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 9px;
  border: 1px solid var(--wf-line);
  background: var(--wf-panel);
  color: var(--wf-ink-dim);
  transition: 0.25s;
}
.chip.queue {
  border-style: dashed;
}
.chip.run {
  border-color: var(--wf-amber);
  color: var(--wf-amber);
  background: rgba(255, 176, 0, 0.1);
}
.chip.done {
  border-color: rgba(103, 224, 138, 0.4);
  color: var(--wf-green);
  background: rgba(103, 224, 138, 0.07);
}
.card {
  background: var(--wf-panel);
  border: 1px solid var(--wf-line);
  border-radius: 14px;
}
.panel {
  padding: 20px;
}
.lbl {
  display: block;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--wf-ink-dim);
}
.lbl b {
  color: var(--wf-amber);
}
.slider {
  width: 100%;
  accent-color: var(--wf-amber);
  margin: 12px 0;
}
.btn {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  cursor: pointer;
  width: 100%;
  padding: 10px 16px;
  border-radius: 9px;
}
.btn.primary {
  background: var(--wf-amber);
  color: #100c00;
  border: 1px solid var(--wf-amber);
  font-weight: 600;
}
.btn.ghost {
  margin-top: 8px;
  background: var(--wf-panel);
  border: 1px solid var(--wf-line-bright);
  color: var(--wf-ink);
}
.btn.ghost:hover {
  border-color: var(--wf-amber);
  color: var(--wf-amber);
}
.note {
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: var(--wf-ink-faint);
  margin: 14px 0 0;
  line-height: 1.6;
}
@media (max-width: 760px) {
  .sema {
    grid-template-columns: 1fr;
  }
}
</style>
