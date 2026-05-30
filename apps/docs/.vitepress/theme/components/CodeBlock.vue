<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { getHighlighter } from "../useShiki";

const props = withDefaults(
  defineProps<{ code: string; lang?: string; fn?: string }>(),
  { lang: "typescript" },
);

const html = ref("");

async function render() {
  const hl = await getHighlighter();
  html.value = hl.codeToHtml(props.code, { lang: props.lang, theme: "vesper" });
}

onMounted(render);
watch(() => props.code, render);
</script>

<template>
  <div class="codecard">
    <div class="bar">
      <span class="b r" />
      <span class="b y" />
      <span class="b g" />
      <span v-if="fn" class="fn">{{ fn }}</span>
    </div>
    <div v-if="html" class="shiki-host" v-html="html" />
    <pre v-else class="shiki-host raw"><code>{{ code }}</code></pre>
  </div>
</template>

<style scoped>
.codecard {
  background: #0d0f13;
  border: 1px solid var(--wf-line);
  border-radius: 14px;
  overflow: hidden;
}
.bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 11px 16px;
  border-bottom: 1px solid var(--wf-line);
  background: var(--wf-panel);
}
.b {
  width: 11px;
  height: 11px;
  border-radius: 50%;
}
.b.r {
  background: #ff5d54;
}
.b.y {
  background: #ffb000;
}
.b.g {
  background: #67e08a;
}
.fn {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--wf-ink-faint);
  margin-left: 8px;
}
.shiki-host {
  font-size: 13.5px;
  line-height: 1.62;
  overflow: auto;
  max-height: 540px;
}
.shiki-host.raw {
  margin: 0;
  padding: 18px 20px;
  color: var(--wf-ink-dim);
  font-family: var(--vp-font-family-mono);
}
.shiki-host :deep(pre) {
  margin: 0;
  padding: 18px 20px !important;
  background: transparent !important;
  font-family: var(--vp-font-family-mono) !important;
}
.shiki-host :deep(code) {
  font-family: var(--vp-font-family-mono) !important;
}
</style>
