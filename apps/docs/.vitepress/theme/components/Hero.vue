<script setup lang="ts">
import { withBase } from "vitepress";
import CodeBlock from "./CodeBlock.vue";
import { samples } from "../code-samples";

const agents = [0, 1, 2, 3, 4];
</script>

<template>
  <header class="hero">
    <div class="inner">
      <div class="left">
        <div class="wf-eyebrow">deterministic · crash-safe · harness-agnostic</div>
        <h1 class="title">
          defineworkflow<span class="comma">,</span><br />
          <span class="glow">under the hood</span>
        </h1>
        <p class="sub">
          A workflow is a plain JS/TS script that orchestrates coding-agent calls —
          <code>agent()</code>, <code>parallel()</code>, <code>pipeline()</code> — on
          <b>any harness you choose</b>. Run the same script on Claude, Codex, Copilot, or the
          raw API — and <i>mix them in a single run</i>, one agent on Codex, the next on Claude.
          Underneath, every result is journaled by sequence number, so a run replays from a
          checkpoint <i>without re-invoking the model</i>.
        </p>
        <div class="cta">
          <a class="btn primary" :href="withBase('/guide/')">Read the internals →</a>
          <a class="btn" :href="withBase('/guide/agent-lifecycle')">The agent() lifecycle</a>
        </div>
        <div class="flow">
          <span class="node">schema</span><span class="arr">→</span>
          <span class="node">core</span><span class="arr">→</span>
          <span class="node">adapters</span><span class="arr">→</span>
          <span class="node">cli</span>
        </div>
      </div>

      <div class="right">
        <!-- animated fan-out: script → agents → result -->
        <svg class="diagram" viewBox="0 0 360 320" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="wire" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#ffb000" stop-opacity="0.1" />
              <stop offset="0.5" stop-color="#ffb000" stop-opacity="0.65" />
              <stop offset="1" stop-color="#5ad1e0" stop-opacity="0.2" />
            </linearGradient>
          </defs>
          <!-- wires script → agents -->
          <path
            v-for="(a, i) in agents"
            :key="'w1' + i"
            :d="`M70 160 C 150 160, 150 ${44 + i * 58}, 200 ${44 + i * 58}`"
            stroke="url(#wire)"
            stroke-width="1.5"
            class="wire"
            :style="{ animationDelay: i * 0.12 + 's' }"
          />
          <!-- wires agents → result -->
          <path
            v-for="(a, i) in agents"
            :key="'w2' + i"
            :d="`M250 ${44 + i * 58} C 300 ${44 + i * 58}, 300 160, 320 160`"
            stroke="url(#wire)"
            stroke-width="1.5"
            class="wire"
            :style="{ animationDelay: 0.4 + i * 0.1 + 's' }"
          />
          <!-- script node -->
          <g class="pulse-slow">
            <rect x="34" y="142" width="40" height="36" rx="9" fill="#13161b" stroke="#313842" />
            <text x="54" y="165" class="lbl">.ts</text>
          </g>
          <!-- agent nodes -->
          <g
            v-for="(a, i) in agents"
            :key="'n' + i"
            class="agent-node"
            :style="{ animationDelay: i * 0.18 + 's' }"
          >
            <rect
              :x="200"
              :y="30 + i * 58"
              width="50"
              height="28"
              rx="8"
              fill="#171b21"
              stroke="#ffb000"
              stroke-opacity="0.55"
            />
            <text :x="225" :y="48 + i * 58" class="lbl amber">seq {{ i }}</text>
          </g>
          <!-- result node -->
          <g class="pulse-slow" style="animation-delay: 0.6s">
            <rect x="318" y="142" width="40" height="36" rx="9" fill="#13161b" stroke="#5ad1e0" stroke-opacity="0.6" />
            <text x="338" y="165" class="lbl cyan">✓</text>
          </g>
        </svg>

        <CodeBlock :code="samples.workflow" fn="research-bugs.workflow.ts" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.hero {
  position: relative;
  border-bottom: 1px solid var(--wf-line);
  overflow: hidden;
}
.inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 84px 32px 76px;
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: 56px;
  align-items: center;
}
.title {
  font-family: "Big Shoulders Display", sans-serif;
  font-weight: 900;
  font-size: clamp(52px, 7vw, 104px);
  line-height: 0.9;
  margin: 16px 0 0;
  color: var(--wf-ink);
  letter-spacing: 0.01em;
}
.comma {
  color: var(--wf-amber);
}
.glow {
  color: var(--wf-amber);
  text-shadow: 0 0 38px rgba(255, 176, 0, 0.35);
}
.sub {
  font-family: var(--vp-font-family-base);
  font-size: 19px;
  line-height: 1.6;
  color: var(--wf-ink-dim);
  max-width: 54ch;
  margin: 26px 0 0;
}
.sub code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.82em;
  color: var(--wf-ink);
  background: var(--wf-panel);
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid var(--wf-line);
}
.cta {
  display: flex;
  gap: 12px;
  margin-top: 32px;
  flex-wrap: wrap;
}
.btn {
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  text-decoration: none;
  border: 1px solid var(--wf-line-bright);
  background: var(--wf-panel);
  color: var(--wf-ink);
  padding: 11px 20px;
  border-radius: 10px;
  transition: 0.15s;
}
.btn:hover {
  border-color: var(--wf-amber);
  color: var(--wf-amber);
}
.btn.primary {
  background: var(--wf-amber);
  color: #100c00;
  border-color: var(--wf-amber);
  font-weight: 600;
}
.btn.primary:hover {
  filter: brightness(1.08);
  color: #100c00;
}
.flow {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 38px;
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
}
.flow .node {
  padding: 7px 13px;
  border: 1px solid var(--wf-line-bright);
  border-radius: 9px;
  background: var(--wf-panel);
  color: var(--wf-ink);
}
.flow .arr {
  color: var(--wf-amber);
}
.right {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.diagram {
  width: 100%;
  height: auto;
  max-height: 230px;
}
.lbl {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  fill: var(--wf-ink-dim);
  text-anchor: middle;
}
.lbl.amber {
  fill: var(--wf-amber);
}
.lbl.cyan {
  fill: var(--wf-cyan);
  font-size: 13px;
}
.wire {
  stroke-dasharray: 6 6;
  animation: dash 1.4s linear infinite;
}
@keyframes dash {
  to {
    stroke-dashoffset: -24;
  }
}
.agent-node {
  animation: rise 0.6s both;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateX(10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
.pulse-slow {
  animation: glow 2.6s ease-in-out infinite;
}
@keyframes glow {
  0%,
  100% {
    opacity: 0.85;
  }
  50% {
    opacity: 1;
  }
}
@media (max-width: 860px) {
  .inner {
    grid-template-columns: 1fr;
    gap: 36px;
    padding: 56px 22px;
  }
}
</style>
