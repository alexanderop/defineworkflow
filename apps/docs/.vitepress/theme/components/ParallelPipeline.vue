<script setup lang="ts">
import { ref, computed } from "vue";

const mode = ref<"pipeline" | "parallel">("pipeline");
const items = [0, 1, 2];
// [stage1, stage2] durations per item
const dur = [
  [1, 3],
  [2, 1],
  [3, 2],
];
const unit = 64;
const maxS1 = Math.max(...dur.map((d) => d[0]));

function layout(i: number) {
  const [s1, s2] = dur[i];
  if (mode.value === "parallel") {
    return { x1: 0, w1: s1, x2: maxS1, w2: s2 }; // stage2 waits for ALL stage1 (barrier)
  }
  return { x1: 0, w1: s1, x2: s1, w2: s2 }; // pipeline: stage2 right after this item's stage1
}
const maxEnd = computed(() =>
  Math.max(...items.map((i) => {
    const l = layout(i);
    return l.x2 + l.w2;
  })),
);
</script>

<template>
  <div class="pp">
    <div class="toggle">
      <button :class="{ on: mode === 'pipeline' }" @click="mode = 'pipeline'">pipeline() — no barrier</button>
      <button :class="{ on: mode === 'parallel' }" @click="mode = 'parallel'">parallel() ×2 — barrier</button>
    </div>

    <div class="track">
      <div v-for="i in items" :key="i" class="lane">
        <span class="lane-lab">item {{ i }}</span>
        <div class="bars">
          <div class="seg s1" :style="{ left: layout(i).x1 * unit + 4 + 'px', width: layout(i).w1 * unit - 6 + 'px' }">stage1</div>
          <div class="seg s2" :style="{ left: layout(i).x2 * unit + 4 + 'px', width: layout(i).w2 * unit - 6 + 'px' }">stage2</div>
          <div v-if="mode === 'parallel'" class="barrier" :style="{ left: maxS1 * unit + 'px' }" />
        </div>
      </div>
      <div class="lane">
        <span class="lane-lab" style="color: var(--wf-amber)">wall</span>
        <div class="wall">
          ≈ <b :style="{ color: mode === 'pipeline' ? 'var(--wf-green)' : 'var(--wf-red)' }">{{ maxEnd }} units</b>
          <template v-if="mode === 'parallel'"> — fast items idle at the red barrier waiting for the slowest stage-1</template>
          <template v-else> — slowest single chain, nothing waits</template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pp {
  margin: 26px 0;
}
.toggle {
  display: inline-flex;
  border: 1px solid var(--wf-line-bright);
  border-radius: 10px;
  overflow: hidden;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  margin-bottom: 22px;
}
.toggle button {
  background: var(--wf-panel);
  color: var(--wf-ink-dim);
  border: none;
  padding: 10px 18px;
  cursor: pointer;
  transition: 0.15s;
}
.toggle button.on {
  background: var(--wf-amber);
  color: #100c00;
  font-weight: 600;
}
.track {
  display: grid;
  gap: 10px;
}
.lane {
  display: grid;
  grid-template-columns: 64px 1fr;
  align-items: center;
  gap: 12px;
}
.lane-lab {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--wf-ink-dim);
}
.bars {
  position: relative;
  height: 34px;
  background: var(--wf-panel);
  border: 1px solid var(--wf-line);
  border-radius: 8px;
  overflow: hidden;
}
.seg {
  position: absolute;
  top: 4px;
  height: 26px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: #100c00;
  font-weight: 600;
  transition: 0.5s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.seg.s1 {
  background: var(--wf-cyan);
}
.seg.s2 {
  background: var(--wf-amber);
}
.barrier {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--wf-red);
  box-shadow: 0 0 8px var(--wf-red);
}
.wall {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--wf-ink-dim);
}
</style>
