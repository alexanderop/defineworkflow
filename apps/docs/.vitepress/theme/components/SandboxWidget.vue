<script setup lang="ts">
import { ref, computed } from "vue";

type Case = { id: string; code: string; ok?: string; err?: string };
const CASES: Case[] = [
  { id: "now", code: "const t = Date.now()", err: "SandboxViolation: Date.now() is not allowed in a workflow" },
  { id: "rand", code: "const r = Math.random()", err: "SandboxViolation: Math.random() is not allowed in a workflow" },
  { id: "date", code: "const d = new Date()", err: "SandboxViolation: argless new Date() is not allowed in a workflow" },
  { id: "ok", code: 'const d = new Date("2026-05-30")', ok: "✓ allowed — an explicit timestamp is deterministic" },
  { id: "ok2", code: "const r = (idx % 7) / 7  // derive from the index", ok: "✓ allowed — varies by item without randomness" },
];

const sel = ref("now");
const v = computed(() => CASES.find((c) => c.id === sel.value)!);
</script>

<template>
  <div class="sb">
    <div class="picks">
      <button
        v-for="c in CASES"
        :key="c.id"
        class="pick"
        :class="{ on: c.id === sel }"
        @click="sel = c.id"
      >
        {{ c.code }}
      </button>
    </div>

    <div class="console">
      <div class="ln mut">$ defineworkflow run my.workflow.ts</div>
      <div class="ln"><span class="mut">›</span><span class="ink">{{ v.code }}</span></div>
      <div class="ln">
        <span v-if="v.err" class="err">✗ {{ v.err }}</span>
        <span v-else class="ok">{{ v.ok }}</span>
      </div>
      <div class="ln mut spacer">
        // need time/randomness? pass it via <b>args</b>, or derive from the item index.
      </div>
    </div>
  </div>
</template>

<style scoped>
.sb {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin: 26px 0;
}
.picks {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pick {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  text-align: left;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--wf-line);
  background: var(--wf-panel);
  color: var(--wf-ink);
  cursor: pointer;
  transition: 0.14s;
}
.pick:hover {
  border-color: var(--wf-line-bright);
}
.pick.on {
  border-color: var(--wf-amber);
  background: rgba(255, 176, 0, 0.08);
}
.console {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  background: #0d0f13;
  border: 1px solid var(--wf-line);
  border-radius: 12px;
  padding: 18px;
  min-height: 170px;
}
.ln {
  display: flex;
  gap: 10px;
  padding: 3px 0;
}
.mut {
  color: var(--wf-ink-faint);
}
.ink {
  color: var(--wf-ink);
}
.ok {
  color: var(--wf-green);
}
.err {
  color: var(--wf-red);
}
.spacer {
  margin-top: 10px;
}
@media (max-width: 760px) {
  .sb {
    grid-template-columns: 1fr;
  }
}
</style>
