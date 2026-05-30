<script setup lang="ts">
import { ref, computed } from "vue";
import CodeBlock from "./CodeBlock.vue";
import { samples } from "../code-samples";

const SCRIPT = [
  { type: "run-started", c: "var(--wf-cyan)" },
  { type: "phase-started", c: "var(--wf-violet)" },
  { type: "agent-queued", c: "var(--wf-ink-dim)" },
  { type: "agent-started", c: "var(--wf-amber)" },
  { type: "agent-tool", c: "var(--wf-amber)" },
  { type: "agent-output", c: "var(--wf-amber)" },
  { type: "agent-finished", c: "var(--wf-green)" },
  { type: "run-finished", c: "var(--wf-cyan)" },
];

const feed = ref<{ type: string; c: string }[]>([]);
const running = ref(false);

const done = computed(() => feed.value.filter((e) => e.type === "agent-finished").length);
const status = computed(() =>
  feed.value.some((e) => e.type === "run-finished") ? "finished" : running.value ? "running" : "pending",
);

function play() {
  if (running.value) return;
  running.value = true;
  feed.value = [];
  let k = 0;
  const tick = () => {
    feed.value = [...feed.value, SCRIPT[k]];
    k++;
    if (k < SCRIPT.length) setTimeout(tick, 520);
    else running.value = false;
  };
  setTimeout(tick, 160);
}
</script>

<template>
  <div class="es">
    <div class="card stream">
      <div class="head">
        <span class="wf-eyebrow">event stream</span>
        <button class="btn primary" :disabled="running" @click="play">{{ running ? "emitting…" : "▶ emit" }}</button>
      </div>
      <div class="console">
        <div v-if="!feed.length" class="ln mut">// press emit — events flow as the run progresses</div>
        <div v-for="(e, k) in feed" :key="k" class="ln">
          <span class="mut">{{ String(k).padStart(2, "0") }}</span>
          <span :style="{ color: e.c }">{{ e.type }}</span>
        </div>
      </div>
    </div>

    <div class="right">
      <div class="card rs">
        <span class="wf-eyebrow">RunState (reduced)</span>
        <div class="grid">
          <div>
            <div class="big">{{ status }}</div>
            <div class="cap">status</div>
          </div>
          <div>
            <div class="big">{{ done }}</div>
            <div class="cap">agents done</div>
          </div>
        </div>
      </div>
      <CodeBlock :code="samples.reduce" fn="events.ts · reduce()" lang="javascript" />
    </div>
  </div>
</template>

<style scoped>
.es {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin: 26px 0;
  align-items: start;
}
.card {
  background: var(--wf-panel);
  border: 1px solid var(--wf-line);
  border-radius: 14px;
}
.stream {
  padding: 18px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.btn.primary {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  cursor: pointer;
  background: var(--wf-amber);
  color: #100c00;
  border: 1px solid var(--wf-amber);
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 9px;
}
.btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.console {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  background: #0d0f13;
  border: 1px solid var(--wf-line);
  border-radius: 12px;
  padding: 16px;
  min-height: 270px;
}
.ln {
  display: flex;
  gap: 10px;
  padding: 3px 0;
}
.mut {
  color: var(--wf-ink-faint);
}
.right {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rs {
  padding: 20px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 14px;
}
.big {
  font-family: "Big Shoulders Display", sans-serif;
  font-weight: 900;
  font-size: 32px;
  color: var(--wf-ink);
  line-height: 1;
}
.cap {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--wf-ink-dim);
  margin-top: 4px;
}
@media (max-width: 760px) {
  .es {
    grid-template-columns: 1fr;
  }
}
</style>
