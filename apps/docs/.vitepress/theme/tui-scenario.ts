// A fabricated event stream that mirrors packages/examples/src/feature-pipeline.workflow.ts:
// PRD → Decompose → (TDD → Review → Refactor per subtask, pipelined) → Integrate → Cleanup.
//
// This is what `defineworkflow run feature-pipeline.workflow.ts --mock` produces in spirit:
// schema-valid, deterministic, no real agents — enriched here with realistic tool calls,
// climbing token counts, and model ids so the terminal UI shows its full richness. Two
// subtasks flow through the build pipeline INDEPENDENTLY, so you can watch subtask B in
// Review while subtask A is still in TDD — exactly how pipeline() interleaves stages.
//
// `at` values are absolute ms from run start; the player reveals each event on this
// timeline (scaled by the speed control).
import type { WorkflowEvent } from "./tui-replay";

const OPUS = "claude-opus-4-8[1m]";
const SONNET = "claude-sonnet-4-6";
const HAIKU = "claude-haiku-4-5-20251001";

// Helper to keep the authored stream compact and readable.
type Ev = WorkflowEvent;
const started = (key: string, at: number): Ev => ({ type: "agent-started", key, at });
const tool = (key: string, name: string, input: unknown, at: number): Ev => ({ type: "agent-tool", key, tool: { name, input }, at });
const progress = (key: string, tokens: number, at: number, model?: string): Ev =>
  model ? { type: "agent-progress", key, tokens, model, at } : { type: "agent-progress", key, tokens, at };
const output = (key: string, chunk: string, at: number): Ev => ({ type: "agent-output", key, chunk, at });
const finished = (key: string, inputTokens: number, outputTokens: number, model: string, at: number): Ev => ({
  type: "agent-finished",
  key,
  usage: { inputTokens, outputTokens },
  cached: false,
  model,
  at,
});

export const SCENARIO: readonly WorkflowEvent[] = [
  { type: "run-started", runId: "feature-pipeline-3f9a2", name: "feature-pipeline", at: 0 },

  // ── PRD ───────────────────────────────────────────────────────────────────────
  { type: "phase-started", phase: "PRD", at: 100 },
  { type: "log", message: "writing a PRD for: a token-bucket rate limiter for a public REST API", at: 120 },
  {
    type: "agent-queued",
    key: "prd",
    label: "prd",
    phase: "PRD",
    prompt:
      "You are a product engineer. Write a concise, implementation-ready PRD for this feature request:\n\n\"a token-bucket rate limiter for a public REST API\"\n\nKeep requirements testable and the scope TINY — this is a pipeline probe, not a product.\nBe specific about non-goals so the build stays small.",
    at: 150,
  },
  started("prd", 300),
  progress("prd", 120, 600, OPUS),
  tool("prd", "Read", { file: "docs/prd-template.md" }, 900),
  progress("prd", 480, 1400),
  tool("prd", "StructuredOutput", undefined, 2100),
  progress("prd", 910, 2200),
  output("prd", '{"title":"Token-Bucket Rate Limiter","goals":["Cap requests per client","Refill tokens over time"]}', 2300),
  finished("prd", 1850, 910, OPUS, 2400),
  { type: "log", message: 'PRD "Token-Bucket Rate Limiter": 5 requirements, 2 goals', at: 2450 },

  // ── Decompose ───────────────────────────────────────────────────────────────────
  { type: "phase-started", phase: "Decompose", at: 2500 },
  {
    type: "agent-queued",
    key: "decompose",
    label: "decompose",
    phase: "Decompose",
    prompt:
      "Break this PRD into 2-4 small, independently-implementable vertical slices, ordered by dependency. Each subtask must be buildable test-first in one pass as a single small module.",
    at: 2550,
  },
  started("decompose", 2650),
  progress("decompose", 200, 3000, SONNET),
  tool("decompose", "StructuredOutput", undefined, 3600),
  progress("decompose", 540, 3700),
  output("decompose", '{"subtasks":[{"id":"token-bucket-core"},{"id":"refill-clock"}]}', 3800),
  finished("decompose", 940, 540, SONNET, 3900),
  { type: "log", message: "decomposed into 2 subtasks: token-bucket-core, refill-clock", at: 3950 },

  // ── Build pipeline (TDD → Review → Refactor), interleaved across 2 subtasks ──────
  // Subtask A: token-bucket-core
  { type: "phase-started", phase: "TDD", at: 4000 },
  {
    type: "agent-queued",
    key: "tdd:token-bucket-core",
    label: "tdd:token-bucket-core",
    phase: "TDD",
    prompt:
      "Implement this subtask TEST-FIRST in /tmp/workflow-feature-pipeline/token-bucket-core:\n1. Reset the dir.\n2. Write the failing tests first, RUN them and confirm they FAIL (red).\n3. Write the minimal implementation, RUN the tests and confirm they PASS (green).\nActually execute the commands with your tools — do not just describe them.",
    at: 4050,
  },
  started("tdd:token-bucket-core", 4100),
  progress("tdd:token-bucket-core", 300, 4400, SONNET),
  tool("tdd:token-bucket-core", "Bash", { command: "rm -rf token-bucket-core && mkdir -p token-bucket-core" }, 4600),
  tool("tdd:token-bucket-core", "Write", { file: "token-bucket.test.mjs" }, 5200),
  progress("tdd:token-bucket-core", 1400, 5400),
  tool("tdd:token-bucket-core", "Bash", { command: "node --test token-bucket.test.mjs" }, 6000),
  output("tdd:token-bucket-core", "tests failing (red) — 0 passing, 4 failing", 6100),
  tool("tdd:token-bucket-core", "Write", { file: "token-bucket.mjs" }, 6800),
  progress("tdd:token-bucket-core", 2600, 7000),
  tool("tdd:token-bucket-core", "Bash", { command: "node --test token-bucket.test.mjs" }, 7600),
  output("tdd:token-bucket-core", "tests passing (green) — 4 passing", 7700),
  tool("tdd:token-bucket-core", "StructuredOutput", undefined, 7900),
  finished("tdd:token-bucket-core", 4200, 2900, SONNET, 8000),

  // Subtask B: refill-clock — queued early, runs once a semaphore slot frees
  {
    type: "agent-queued",
    key: "tdd:refill-clock",
    label: "tdd:refill-clock",
    phase: "TDD",
    prompt:
      "Implement this subtask TEST-FIRST in /tmp/workflow-feature-pipeline/refill-clock:\n1. Reset the dir.\n2. Write the failing tests first, RUN them and confirm they FAIL (red).\n3. Write the minimal implementation, RUN the tests and confirm they PASS (green).",
    at: 4080,
  },
  started("tdd:refill-clock", 4700),
  progress("tdd:refill-clock", 280, 5000, SONNET),
  tool("tdd:refill-clock", "Bash", { command: "rm -rf refill-clock && mkdir -p refill-clock" }, 5300),
  tool("tdd:refill-clock", "Write", { file: "refill.test.mjs" }, 6000),
  progress("tdd:refill-clock", 1500, 6400),
  tool("tdd:refill-clock", "Bash", { command: "node --test refill.test.mjs" }, 7000),
  output("tdd:refill-clock", "tests failing (red) — 0 passing, 3 failing", 7100),
  tool("tdd:refill-clock", "Write", { file: "refill.mjs" }, 8200),
  progress("tdd:refill-clock", 2800, 8600),
  tool("tdd:refill-clock", "Bash", { command: "node --test refill.test.mjs" }, 9400),
  output("tdd:refill-clock", "tests passing (green) — 3 passing", 9500),
  finished("tdd:refill-clock", 4400, 3050, SONNET, 9700),

  // Review — A enters Review the moment its TDD finishes (no barrier)
  { type: "phase-started", phase: "Review", at: 8050 },
  {
    type: "agent-queued",
    key: "review:token-bucket-core",
    label: "review:token-bucket-core",
    phase: "Review",
    prompt:
      "You are a senior reviewer. The implementation for \"token-bucket-core\" lives in /tmp/workflow-feature-pipeline/token-bucket-core.\n1. Read the files there.\n2. Re-run the tests and record whether they pass.\n3. Critique correctness, edge cases, missing tests, and design.",
    at: 8100,
  },
  started("review:token-bucket-core", 8150),
  progress("review:token-bucket-core", 260, 8500, OPUS),
  tool("review:token-bucket-core", "Read", { file: "token-bucket.mjs" }, 8800),
  tool("review:token-bucket-core", "Read", { file: "token-bucket.test.mjs" }, 9300),
  tool("review:token-bucket-core", "Bash", { command: "node --test token-bucket.test.mjs" }, 9900),
  progress("review:token-bucket-core", 1600, 10200),
  tool("review:token-bucket-core", "StructuredOutput", undefined, 10600),
  output("review:token-bucket-core", '{"verdict":"request-changes","findings":[{"severity":"major","note":"burst beyond capacity not clamped"}]}', 10700),
  finished("review:token-bucket-core", 3900, 1900, OPUS, 10800),

  {
    type: "agent-queued",
    key: "review:refill-clock",
    label: "review:refill-clock",
    phase: "Review",
    prompt:
      "You are a senior reviewer. The implementation for \"refill-clock\" lives in /tmp/workflow-feature-pipeline/refill-clock.\nRead the files, re-run the tests, and critique correctness, edge cases, and design.",
    at: 9750,
  },
  started("review:refill-clock", 9800),
  progress("review:refill-clock", 240, 10100, OPUS),
  tool("review:refill-clock", "Read", { file: "refill.mjs" }, 10400),
  tool("review:refill-clock", "Bash", { command: "node --test refill.test.mjs" }, 11000),
  progress("review:refill-clock", 1500, 11300),
  tool("review:refill-clock", "StructuredOutput", undefined, 11700),
  output("review:refill-clock", '{"verdict":"approve","testsPass":true,"findings":[]}', 11800),
  finished("review:refill-clock", 3700, 1750, OPUS, 11900),

  // Refactor — A had findings, so it refactors; B was approved clean and is skipped
  { type: "phase-started", phase: "Refactor", at: 10850 },
  { type: "log", message: "refill-clock: approved clean, skipping refactor", at: 11950 },
  {
    type: "agent-queued",
    key: "refactor:token-bucket-core",
    label: "refactor:token-bucket-core",
    phase: "Refactor",
    prompt:
      "Apply this review feedback to the code in /tmp/workflow-feature-pipeline/token-bucket-core. Address every blocker/major/minor finding and refactor for clarity. After editing, RE-RUN the tests and confirm they still pass.\n\nFindings:\n- [major] burst beyond capacity not clamped",
    at: 10900,
  },
  started("refactor:token-bucket-core", 10950),
  progress("refactor:token-bucket-core", 300, 11300, SONNET),
  tool("refactor:token-bucket-core", "Read", { file: "token-bucket.mjs" }, 11600),
  tool("refactor:token-bucket-core", "Edit", { file: "token-bucket.mjs" }, 12200),
  progress("refactor:token-bucket-core", 1400, 12500),
  tool("refactor:token-bucket-core", "Bash", { command: "node --test token-bucket.test.mjs" }, 13100),
  output("refactor:token-bucket-core", "tests still passing — 5 passing", 13200),
  tool("refactor:token-bucket-core", "StructuredOutput", undefined, 13400),
  finished("refactor:token-bucket-core", 3100, 1600, SONNET, 13500),
  { type: "log", message: "built 2/2 subtasks", at: 13600 },

  // ── Integrate ───────────────────────────────────────────────────────────────────
  { type: "phase-started", phase: "Integrate", at: 13650 },
  {
    type: "agent-queued",
    key: "integrate",
    label: "integrate",
    phase: "Integrate",
    prompt:
      "The feature \"Token-Bucket Rate Limiter\" was built across these subtask directories. You may read them to verify. Write a concise delivery report in Markdown with a summary, an Acceptance Criteria checklist, a per-subtask section, and a Follow-ups / Risks section.",
    at: 13700,
  },
  started("integrate", 13750),
  progress("integrate", 320, 14100, OPUS),
  tool("integrate", "Read", { file: "token-bucket-core/token-bucket.mjs" }, 14400),
  tool("integrate", "Read", { file: "refill-clock/refill.mjs" }, 14900),
  progress("integrate", 1800, 15300),
  output("integrate", "# Token-Bucket Rate Limiter — Delivery Report\n\nBoth slices ship green. 2/2 subtasks complete.", 15600),
  finished("integrate", 5200, 2400, OPUS, 15800),

  // ── Cleanup (always runs — the finally block) ─────────────────────────────────────
  { type: "phase-started", phase: "Cleanup", at: 15850 },
  { type: "log", message: "cleaning up workspace /tmp/workflow-feature-pipeline", at: 15900 },
  {
    type: "agent-queued",
    key: "cleanup",
    label: "cleanup",
    phase: "Cleanup",
    prompt:
      "Delete the throwaway workspace: run `rm -rf \"/tmp/workflow-feature-pipeline\"` and confirm it is gone. Reply with a one-line confirmation.",
    at: 15950,
  },
  started("cleanup", 16000),
  tool("cleanup", "Bash", { command: 'rm -rf "/tmp/workflow-feature-pipeline"' }, 16300),
  progress("cleanup", 90, 16500, HAIKU),
  tool("cleanup", "Bash", { command: 'ls "/tmp/workflow-feature-pipeline"' }, 16700),
  output("cleanup", "workspace removed — confirmed gone", 16900),
  finished("cleanup", 600, 90, HAIKU, 17000),

  { type: "run-finished", runId: "feature-pipeline-3f9a2", at: 17100 },
];
