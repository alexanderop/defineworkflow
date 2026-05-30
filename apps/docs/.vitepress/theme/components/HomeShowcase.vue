<script setup lang="ts">
import { withBase } from "vitepress";

const stats = [
  { n: "13", l: "steps per agent()" },
  { n: "1", l: "vm sandbox" },
  { n: "∞", l: "replays · 0 tokens" },
  { n: "4", l: "harness adapters" },
];

const cards = [
  { ic: "01", title: "The agent() lifecycle", body: "Step through all 13 stages one agent() call walks — seq, gates, semaphore, validate, journal, release.", link: "/guide/agent-lifecycle" },
  { ic: "02", title: "Journal & resume", body: "Crash, then resume for free. Drag the crash point and watch journaled entries replay with zero model calls.", link: "/guide/journal-resume" },
  { ic: "03", title: "Concurrency", body: "A tiny counting semaphore hands out N slots; the rest queue and wake FIFO in a finally.", link: "/guide/concurrency" },
  { ic: "04", title: "parallel vs pipeline", body: "See the barrier: where fast items idle, and where each item flows through stages independently.", link: "/guide/parallel-pipeline" },
  { ic: "05", title: "Events & RunState", body: "The only observable. A pure reduce folds a typed event stream into the state the UI and registry consume.", link: "/guide/events" },
  { ic: "06", title: "The sandbox", body: "Why Date.now(), Math.random() and argless new Date() are hard-banned — determinism is the contract.", link: "/guide/sandbox" },
];
</script>

<template>
  <section class="showcase">
    <div class="wrap">
      <div class="stat-row">
        <div v-for="s in stats" :key="s.l" class="stat">
          <div class="n">{{ s.n }}</div>
          <div class="l">{{ s.l }}</div>
        </div>
      </div>

      <div class="kick">
        <span class="wf-eyebrow">explore the internals</span>
        <h2>Read the machine, not the marketing.</h2>
        <p>Six interactive walkthroughs, each built from the real source of <code>@workflow/core</code>.</p>
      </div>

      <div class="cards">
        <a v-for="c in cards" :key="c.title" class="fcard" :href="withBase(c.link)">
          <div class="ic">{{ c.ic }}</div>
          <h3>{{ c.title }}</h3>
          <p>{{ c.body }}</p>
          <span class="go">open →</span>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.showcase {
  border-bottom: 1px solid var(--wf-line);
}
.wrap {
  max-width: 1180px;
  margin: 0 auto;
  padding: 64px 32px 88px;
}
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--wf-line);
  border: 1px solid var(--wf-line);
  border-radius: 14px;
  overflow: hidden;
}
.stat {
  background: var(--wf-panel);
  padding: 22px;
}
.stat .n {
  font-family: "Big Shoulders Display", sans-serif;
  font-weight: 900;
  font-size: 42px;
  color: var(--wf-amber);
  line-height: 1;
}
.stat .l {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--wf-ink-dim);
  margin-top: 8px;
}
.kick {
  margin: 64px 0 26px;
}
.kick h2 {
  font-family: "Big Shoulders Display", sans-serif;
  font-weight: 900;
  font-size: 42px;
  color: var(--wf-ink);
  margin: 12px 0 6px;
  line-height: 1;
}
.kick p {
  color: var(--wf-ink-dim);
  font-family: var(--vp-font-family-base);
  font-size: 17px;
  margin: 0;
}
.kick code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.85em;
  color: var(--wf-amber-soft);
}
.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.fcard {
  display: block;
  text-decoration: none;
  background: var(--wf-panel);
  border: 1px solid var(--wf-line);
  border-radius: 14px;
  padding: 22px;
  transition: 0.16s;
}
.fcard:hover {
  border-color: var(--wf-amber);
  transform: translateY(-2px);
}
.fcard .ic {
  font-family: var(--vp-font-family-mono);
  color: var(--wf-amber);
  font-size: 13px;
}
.fcard h3 {
  font-family: "Big Shoulders Display", sans-serif;
  font-weight: 900;
  font-size: 22px;
  color: var(--wf-ink);
  margin: 10px 0 6px;
}
.fcard p {
  color: var(--wf-ink-dim);
  font-family: var(--vp-font-family-base);
  font-size: 14.5px;
  margin: 0 0 14px;
  line-height: 1.55;
}
.fcard .go {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--wf-ink-faint);
}
.fcard:hover .go {
  color: var(--wf-amber);
}
@media (max-width: 860px) {
  .stat-row,
  .cards {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
