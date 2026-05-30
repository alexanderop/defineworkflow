<script setup lang="ts">
import { ref, computed, onUnmounted } from "vue";
import {
  reduce,
  initialRunState,
  orderedPhases,
  agentsInPhase,
  agentRow,
  statusGlyph,
  spinnerFrame,
  formatElapsed,
  runElapsedMs,
  detailSections,
  totalDurationMs,
  type WorkflowEvent,
  type AgentStatus,
} from "../tui-replay";
import { SCENARIO } from "../tui-scenario";

// ── Playback state ────────────────────────────────────────────────────────────────
const TICK_MS = 80;
const SPEEDS = [1, 2, 4] as const;

const events = SCENARIO;
const lastAt = totalDurationMs(events);

const simNow = ref(0); // simulated wall-clock (ms from run start)
const frame = ref(0); // spinner frame
const playing = ref(false);
const started = ref(false);
const speed = ref<(typeof SPEEDS)[number]>(1);

// Manual selection pins; null means "auto-follow the live run".
const pinnedPhase = ref<string | null>(null);
const pinnedAgent = ref<string | null>(null);

let timer: ReturnType<typeof setInterval> | undefined;

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

function tick() {
  simNow.value = Math.min(lastAt, simNow.value + TICK_MS * speed.value);
  frame.value += 1;
  if (simNow.value >= lastAt) {
    playing.value = false;
    stopTimer();
  }
}

function run() {
  if (playing.value) return;
  if (simNow.value >= lastAt) replay();
  started.value = true;
  playing.value = true;
  stopTimer();
  timer = setInterval(tick, TICK_MS);
}

function pause() {
  playing.value = false;
  stopTimer();
}

function replay() {
  stopTimer();
  simNow.value = 0;
  frame.value = 0;
  playing.value = false;
  pinnedPhase.value = null;
  pinnedAgent.value = null;
}

onUnmounted(stopTimer);

// ── Derived RunState (identical reduce to the terminal UI) ──────────────────────────
const visible = computed(() => events.filter((e: WorkflowEvent) => e.at <= simNow.value));
const state = computed(() => visible.value.reduce(reduce, initialRunState()));
const now = computed(() => simNow.value);

const phases = computed(() => orderedPhases(state.value));

// Auto-follow the latest active phase until the user clicks one.
const activePhaseTitle = computed(() => {
  const ps = phases.value;
  if (ps.length === 0) return "";
  const running = [...ps].reverse().find((p) => p.running > 0);
  return (running ?? ps[ps.length - 1]).title;
});
const selectedPhase = computed(() => pinnedPhase.value ?? activePhaseTitle.value);

const agents = computed(() => (selectedPhase.value ? agentsInPhase(state.value, selectedPhase.value) : []));

const activeAgentKey = computed(() => {
  const as = agents.value;
  if (as.length === 0) return "";
  const running = [...as].reverse().find((a) => a.status === "running");
  return (running ?? as[as.length - 1]).key;
});
const selectedAgentKey = computed(() => {
  if (pinnedAgent.value && agents.value.some((a) => a.key === pinnedAgent.value)) return pinnedAgent.value;
  return activeAgentKey.value;
});
const selectedAgent = computed(() => agents.value.find((a) => a.key === selectedAgentKey.value));

// ── Header bits ─────────────────────────────────────────────────────────────────
const allAgents = computed(() => [...state.value.agents.values()]);
const doneCount = computed(() => allAgents.value.filter((a) => a.status === "done").length);
const totalCount = computed(() => allAgents.value.length);
const finished = computed(() => state.value.status === "finished");
const headerRight = computed(() => {
  const n = totalCount.value;
  const counts = `${doneCount.value}/${n} agent${n === 1 ? "" : "s"}`;
  return `${counts} · ${formatElapsed(runElapsedMs(state.value, now.value))}${finished.value ? " · done" : ""} · mock`;
});

const progressPct = computed(() => Math.round((simNow.value / lastAt) * 100));

function selectPhase(title: string) {
  pinnedPhase.value = title;
  pinnedAgent.value = null;
}
function selectAgent(key: string) {
  pinnedAgent.value = key;
}

// Per-agent glanceable metrics line: tokens · tools · elapsed.
function metricsFor(key: string): string {
  const a = state.value.agents.get(key);
  if (!a) return "";
  const row = agentRow(a, now.value);
  return [row.tokens ? `${row.tokens} tok` : "", row.toolCount > 0 ? `${row.toolCount} tools` : "", row.elapsed]
    .filter((s) => s !== "")
    .join(" · ");
}
function glyphFor(status: string): string {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- status arrives as a widened string from RunState; statusGlyph narrows it back to the AgentStatus union at runtime
  return statusGlyph(status as AgentStatus, frame.value);
}
const detailLines = computed(() => (selectedAgent.value ? detailSections(selectedAgent.value, now.value) : ["(no agent selected)"]));
</script>

<template>
  <div class="tui">
    <!-- controls -->
    <div class="bar">
      <button class="btn primary" @click="playing ? pause() : run()">
        {{ playing ? "⏸ pause" : finished ? "↻ replay" : started ? "▶ resume" : "▶ run" }}
      </button>
      <button class="btn" :disabled="!started" @click="replay">↻ reset</button>
      <div class="speeds">
        <button
          v-for="s in [1, 2, 4]"
          :key="s"
          class="btn chip"
          :class="{ on: speed === s }"
          @click="speed = s as 1 | 2 | 4"
        >
          {{ s }}×
        </button>
      </div>
      <div class="track"><div class="fill" :style="{ width: progressPct + '%' }" /></div>
    </div>

    <!-- terminal frame -->
    <div class="screen">
      <!-- header -->
      <div class="hdr">
        <span class="name">{{ state.name || "feature-pipeline" }}</span>
        <span class="right">{{ headerRight }}</span>
      </div>
      <div class="desc">Drive a feature from PRD through real on-disk per-subtask TDD, review, refactor, then clean up</div>

      <!-- three-pane body -->
      <div class="body">
        <!-- Phases -->
        <div class="col phases">
          <div class="col-h">Phases</div>
          <div v-if="!phases.length" class="muted">—</div>
          <button
            v-for="p in phases"
            :key="p.title"
            class="row phase"
            :class="{ sel: p.title === selectedPhase }"
            @click="selectPhase(p.title)"
          >
            <span class="g">
              <span v-if="p.running > 0" class="run">{{ spinnerFrame(frame) }}</span>
              <span v-else-if="p.total > 0 && p.done >= p.total" class="ok">✓</span>
              <span v-else class="muted">·</span>
            </span>
            <span class="lbl">{{ p.title }}</span>
            <span class="ct">{{ p.done }}/{{ p.total }}</span>
          </button>
        </div>

        <div class="div" />

        <!-- Agents -->
        <div class="col agents">
          <div class="col-h">{{ selectedPhase || "Agents" }} · {{ agents.length }} agent{{ agents.length === 1 ? "" : "s" }}</div>
          <div v-if="!agents.length" class="muted">not started yet</div>
          <button
            v-for="a in agents"
            :key="a.key"
            class="row agent"
            :class="{ sel: a.key === selectedAgentKey }"
            @click="selectAgent(a.key)"
          >
            <span class="g" :class="{ ok: a.status === 'done', run: a.status === 'running', fail: a.status === 'failed' }">
              {{ glyphFor(a.status) }}
            </span>
            <span class="lbl">{{ a.label }}</span>
            <span class="meta">{{ metricsFor(a.key) }}</span>
          </button>
        </div>

        <div class="div" />

        <!-- Detail -->
        <div class="col detail">
          <div class="col-h">{{ selectedAgent?.label || "Agent" }}</div>
          <div v-for="(line, i) in detailLines" :key="i" class="dline" :class="{ head: line && !line.startsWith('  ') && !line.includes('·') && i > 2 }">
            {{ line === "" ? " " : line }}
          </div>
        </div>
      </div>

      <!-- footer -->
      <div class="ftr">↑↓ select · ↵ prompt · x stop · p pause · s save — click a phase or agent to inspect</div>
    </div>

    <p class="cap">
      Fabricated <code>--mock</code> run — schema-valid, deterministic, zero tokens. Same event stream and
      <code>reduce()</code> the real Ink terminal renders from.
    </p>
  </div>
</template>

<style scoped>
.tui {
  --tg: var(--wf-green, #67e08a);
  --ta: var(--wf-amber, #ffb000);
  --tc: var(--wf-cyan, #5ad1e0);
  --tr: var(--wf-red, #ff5d54);
  --ti: var(--wf-ink, #e7e3d8);
  --td: var(--wf-ink-dim, #9aa0a8);
  --tf: var(--wf-ink-faint, #5b6168);
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  margin: 1.25rem 0;
}

/* controls */
.bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
  flex-wrap: wrap;
}
.btn {
  font: inherit;
  font-size: 0.78rem;
  color: var(--ti);
  background: var(--wf-panel-2, #171b21);
  border: 1px solid var(--wf-line-bright, #313842);
  border-radius: 6px;
  padding: 0.32rem 0.7rem;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.btn:hover:not(:disabled) {
  border-color: var(--ta);
}
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.btn.primary {
  color: #0c0e12;
  background: var(--ta);
  border-color: var(--ta);
  font-weight: 600;
}
.speeds {
  display: flex;
  gap: 0.25rem;
}
.btn.chip {
  padding: 0.32rem 0.55rem;
}
.btn.chip.on {
  border-color: var(--tc);
  color: var(--tc);
}
.track {
  flex: 1;
  min-width: 80px;
  height: 4px;
  background: var(--wf-line, #23282f);
  border-radius: 2px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--ta);
  transition: width 0.08s linear;
}

/* terminal screen */
.screen {
  background: var(--wf-panel, #13161b);
  border: 1px solid var(--wf-line-bright, #313842);
  border-radius: 10px;
  padding: 0.75rem 0.9rem 0.6rem;
  font-size: 0.8rem;
  line-height: 1.55;
}
.hdr {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}
.hdr .name {
  color: var(--tc);
  font-weight: 700;
}
.hdr .right {
  color: var(--td);
}
.desc {
  color: var(--tf);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 0.5rem;
}

.body {
  display: grid;
  grid-template-columns: minmax(150px, 0.7fr) 1px minmax(180px, 1.1fr) 1px minmax(180px, 1.3fr);
  border: 1px solid var(--wf-line, #23282f);
  border-radius: 6px;
  min-height: 230px;
}
.div {
  background: var(--wf-line, #23282f);
}
.col {
  padding: 0.45rem 0.7rem;
  min-width: 0;
}
.col-h {
  color: var(--ti);
  font-weight: 600;
  margin-bottom: 0.25rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.muted {
  color: var(--tf);
}

/* rows */
.row {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  width: 100%;
  text-align: left;
  font: inherit;
  background: none;
  border: 0;
  border-radius: 4px;
  padding: 0.02rem 0.3rem;
  margin: 0 -0.3rem;
  color: var(--ti);
  cursor: pointer;
}
.row:hover {
  background: rgba(255, 255, 255, 0.04);
}
.row.sel {
  background: rgba(90, 209, 224, 0.13);
  box-shadow: inset 2px 0 0 var(--tc);
}
.row .lbl {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row.sel .lbl {
  color: var(--tc);
}
.row .ct,
.row .meta {
  color: var(--td);
  font-size: 0.74rem;
  white-space: nowrap;
}
.g {
  width: 1ch;
  display: inline-block;
  text-align: center;
  color: var(--tf);
}
.g.ok,
.ok {
  color: var(--tg);
}
.g.run,
.run {
  color: var(--ta);
}
.g.fail,
.fail {
  color: var(--tr);
}

/* detail */
.detail {
  white-space: pre-wrap;
}
.dline {
  color: var(--td);
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  min-height: 1.2em;
}
.dline.head {
  color: var(--ti);
  font-weight: 600;
}

.ftr {
  color: var(--tf);
  font-size: 0.72rem;
  margin-top: 0.5rem;
}

.cap {
  color: var(--td);
  font-size: 0.78rem;
  margin: 0.6rem 0 0;
  font-family: var(--vp-font-family-base);
}
.cap code {
  font-family: "IBM Plex Mono", monospace;
  color: var(--ta);
}

@media (max-width: 720px) {
  .body {
    grid-template-columns: 1fr;
  }
  .body .div {
    height: 1px;
  }
}
</style>
