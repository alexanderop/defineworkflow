# Deterministic Multi-Agent Workflow Orchestrator — Design

**Date:** 2026-05-29
**Status:** Approved design, ready for implementation planning

> **Naming note:** packages are written as `@workflow/*` throughout as a placeholder.
> The `@workflow` npm scope is likely taken — **rename the scope before publishing**
> (e.g. `@<org>/workflow-*`). The internal package short-names (`core`, `adapters`,
> `ui`, `cli`, `schema`) and the `workflow` bin name can stay.

## 1. Goal

A portable, harness-agnostic reimplementation of Claude Code's **dynamic workflows**:
a JavaScript/TypeScript library + CLI that orchestrates many subagents from a
deterministic script, where the *control flow* is code you own and each unit of
work is delegated to whatever coding harness the user has installed (Claude Code,
Codex, Copilot, …).

The library must reach **full feature parity** with Claude Code workflows: the
`fan out → reduce → synthesize` shape, `parallel`/`pipeline`/`workflow` primitives,
journaling + resume, budget-aware loops, worktree isolation, the interactive
progress UI with drill-down, save-as-command, and the documented runtime limits.

### Non-goals (v1)

- Reimplementing any harness's own intelligence — we *drive* harnesses, we don't replace them.
- A long-lived daemon (the file-based run registry makes this a clean v2 optimization).
- A hosted/remote execution backend.

## 2. Core concepts (parity with Claude Code)

- A **workflow** is an ESM script with a pure-literal `meta` block (`name`,
  `description`, optional `whenToUse`, `phases`) followed by a body that uses
  injected primitives.
- The **orchestration is deterministic**; only the work inside each `agent()` call
  is model-powered. Intermediate results live in script variables, never in a
  conversation context.
- A **run** executes in an isolated sandbox, in the background, and is **resumable**:
  completed agents return cached results, the rest run live.

### Documented runtime limits we honor

| Constraint | Value | Where enforced |
|---|---|---|
| No mid-run user input | — | runner (only adapter permission prompts can pause) |
| No direct fs/shell from the script | — | `node:vm` sandbox (only agents touch disk) |
| Max concurrent agents | `min(16, cores − 2)` | core scheduler semaphore |
| Max agents per run | 1000 | core scheduler (aborts runaway loops) |
| Determinism | `Date.now`/`Math.random`/argless `new Date()` throw | sandbox guard |

## 3. Architecture decisions (resolved)

| Decision | Choice |
|---|---|
| Agent runtime | **Pluggable CLI adapters** shelling out to harnesses in headless mode |
| Usage surface | **CLI runner over script files** (CLI is a thin wrapper over the public library) |
| v1 scope | **Full parity** incl. journaling/resume, budget, worktree isolation, nested workflows |
| Progress UI | **Full interactive Ink TUI**, Miller-columns / master-detail layout |
| Runtime topology | **Detached process + persisted run registry** (no daemon) |
| Script sandbox | **`node:vm` + banned non-deterministic globals** |
| Structured output | **Adapter-native where available, else prompt-injected; always validate + retry** |
| Schema API | **Zod (typed inference), converted to JSON Schema under the hood** |
| Errors | **Rust-style errors-as-types**: `Result<T, WorkflowError>`, no throwing across module boundaries (via `neverthrow`) |
| Authoring boundary | **Parity surface** (`agent()` returns value, `parallel` → null on failure); Result is internal only |
| Style | **Functional**: pure core, immutable `readonly` data, effects at the edges |
| Lint | **oxlint** + `tsc --strict` |
| Tests | **Vitest** with projects; default suite free + deterministic; opt-in real e2e |

## 4. Monorepo & package boundaries

```
workflow/                      pnpm workspace + turborepo, TypeScript strict, tsup builds
├─ packages/
│  ├─ core        @workflow/core     — primitives (agent, parallel, pipeline, workflow,
│  │                                    phase, log), node:vm sandbox, scheduler/semaphore,
│  │                                    journal + resume, budget, pure event bus/reducer.
│  │                                    No I/O of its own.
│  ├─ schema      @workflow/schema   — Zod ↔ JSON-Schema bridge + validate/retry helper.
│  ├─ adapters    @workflow/adapters — AgentRunner interface + claude/codex/copilot/raw-api
│  │                                    + generic-template adapter; capability flags;
│  │                                    structured-output coercion. Owns process spawning.
│  ├─ ui          @workflow/ui       — Ink columns UI; pure render over the event stream.
│  └─ cli         @workflow/cli      — `workflow` bin: run/watch/list/resume/stop/save/
│                                       adapters; detached spawning; run registry; consent;
│                                       config; bundled workflows.
└─ examples/      deep-research.ts, vue-newsletter.ts (ported from the source post)
```

**Dependency rule (one-directional):** `core` depends on nothing internal;
`schema`, `adapters`, `ui` depend only on `core`'s types; `cli` wires everything.
`core` stays embeddable as a pure library so the programmatic API works without the CLI.

## 5. Authoring API & execution model

Primitives are **injected as globals** (scripts stay import-free, like Claude Code)
**and** re-exported as typed symbols from `@workflow/core` so authoring files
type-check in an editor.

```ts
export const meta = {
  name: 'deep-research',
  description: 'Fan out searches, verify claims, synthesize a cited report',
  phases: [{ title: 'Scope' }, { title: 'Search' }, { title: 'Verify' }, { title: 'Synthesize' }],
} as const

const Claim = z.object({ text: z.string(), source: z.string().url(), confidence: z.number() })

phase('Scope')
const angles = await agent(`Decompose: ${args.question}`, { schema: z.array(z.string()) })
//    ^? string[]  — inferred from the Zod schema

phase('Search')
const hits = await parallel(angles.map(a => () => agent(`Search: ${a}`, { schema: z.array(Claim) })))
const claims = hits.filter(Boolean).flat()

return { report: await agent(synthPrompt(claims)) }
```

### Primitives

- **`agent(prompt, opts?)`** → `string` with no schema, else `z.infer<typeof schema>`.
  `opts`: `label`, `phase`, `schema` (Zod), `model`, `agentType`, `adapter`
  (override harness for this call), `isolation: 'worktree'`.
- **`parallel(thunks)`** — barrier; awaits all; a failed thunk resolves to `null`
  (always `.filter(Boolean)`).
- **`pipeline(items, ...stages)`** — no barrier between stages; each stage callback
  receives `(prev, item, index)`; a throwing stage drops that item to `null`.
- **`workflow(nameOrRef, args?)`** — nested run, one level deep, sharing the parent's
  semaphore + budget + registry entry.
- **Globals:** `args`, `budget` (`{ total: number|null, spent(): number, remaining(): number }`),
  `phase(title)`, `log(msg)`.

### Execution & determinism

- **Concurrency:** a single global semaphore capped at `min(16, cores − 2)`.
  `parallel`/`pipeline` enqueue; the scheduler drains. Nested workflows draw from
  the *same* semaphore, so total concurrency stays bounded. Hard ceiling of 1000
  agents/run.
- **Determinism guard:** inside the vm, `Date.now`, `Math.random`, argless
  `new Date()` throw (`SandboxViolation`). All timestamps are stamped by the runner
  *outside* the sandbox onto each event, never by the script — this is what keeps
  the journal valid for replay.

### Divergence from Claude Code (intentional)

Typed primitives are importable from `@workflow/core` in addition to being injected
globals, giving authors full type-checking on workflow files. Claude Code's are
globals-only.

## 6. Adapter layer — how `agent()` reaches each harness

```ts
interface AgentRunner {
  readonly id: string                       // 'claude' | 'codex' | 'copilot' | 'raw-api' | custom
  readonly capabilities: {
    readonly nativeSchema: boolean
    readonly reportsTokens: boolean
    readonly toolEvents: boolean
  }
  run(req: AgentRequest, ctx: RunCtx): Promise<Result<AgentResult, WorkflowError>>
}

interface AgentRequest {
  readonly prompt: string
  readonly schema?: JSONSchema
  readonly model?: string
  readonly agentType?: string
  readonly cwd: string
  readonly signal: AbortSignal              // powers pause / stop (x) / restart (r)
}

interface AgentResult {
  readonly text: string
  readonly data?: unknown                   // validated against schema
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
  readonly toolCalls: readonly ToolEvent[]  // feeds the drill-down "tool calls" pane
}
```

### Verified command mappings (from installed CLIs)

**codex** — `codex exec` v0.125.0, **native structured output**:
```
codex exec --json --output-schema <schema.json> -o <last-msg-file> \
           -m <model> -C <cwd> --full-auto "<prompt>"
```
`--output-schema` takes a JSON Schema file (fed from the Zod→JSON-Schema bridge);
`--json` emits JSONL events (token usage + tool calls); `-o` writes the final
message. → `{ nativeSchema: true, reportsTokens: true, toolEvents: true }`.

**copilot** — GitHub Copilot CLI v1.0.55, no native schema flag:
```
copilot -p "<prompt>" --output-format json --allow-all-tools --no-ask-user \
        --model <model> -C <cwd> [--add-dir <worktree>]
```
`--output-format json` is JSONL (usage + tool events). `--allow-all-tools`
+ `--no-ask-user` are **required** for unattended runs. No schema flag →
prompt-injected schema + validate/retry. → `{ nativeSchema: false, reportsTokens: true, toolEvents: true }`.

**claude** — `claude -p --output-format stream-json`; native tool-forcing schema +
full event stream. → `{ nativeSchema: true, reportsTokens: true, toolEvents: true }`.

**raw-api** — Anthropic/OpenAI SDK direct. Exact tokens always; deterministic;
used as the CI/test adapter and the fallback when no harness CLI is detected.
→ `{ nativeSchema: true, reportsTokens: true, toolEvents: false }`.

### Structured-output coercion

If `capabilities.nativeSchema`, use the harness's native mechanism
(codex `--output-schema`, claude tool-forcing); else inject the JSON Schema into the
prompt and parse fenced JSON from stdout. **Either way the result is validated
against the Zod-derived JSON Schema, and on failure retried up to N times** with the
validation error appended to the prompt (`SchemaValidation` error after N).
Adapters lacking `reportsTokens` get an estimated count (chars/4), flagged
approximate in the UI so `budget` still functions everywhere.

### Adapter selection precedence

`agent({adapter})` → `meta.defaultAdapter` → CLI `--adapter` → auto-detect
(probe `$PATH` for `claude`/`codex`/`copilot`, else `raw-api`).

### Note on harness-native resume

Each harness has its own session resume (`codex exec resume`, `copilot --resume`).
We deliberately **do not** rely on it; resume is implemented at the orchestration
layer (§7) so it behaves identically across all adapters.

### Generic-template adapter (extensibility)

Custom adapters declared by config (no TypeScript required) so Gemini CLI / aider /
cursor work:
```json
{ "adapters": { "gemini": {
  "command": "gemini", "promptArg": "stdin",
  "args": ["-o", "json"], "parse": "jsonl",
  "resultPath": "response", "usagePath": "usageMetadata"
}}}
```

## 7. Run lifecycle, journaling & resume

Each run gets `~/.workflow/runs/<runId>/`:
```
meta.json        # script path, args, adapter, status, started/ended (runner-stamped)
journal.jsonl    # one record per agent() call: {seq, key, status, result, usage}
events.jsonl     # append-only UI event log: phase/agent transitions, logs
script.snapshot  # exact script bytes used (resume replays identical code)
```

- **Journaling:** each `agent()` call is keyed by a deterministic sequence
  (call-order index + phase + label). Reproducible because the sandbox bans
  non-determinism. On completion the runner appends the validated result.
- **Resume (`workflow resume <id>`):** re-executes the script from the top; each
  `agent()` first checks the journal — a hit returns the cached result instantly
  without spawning a harness; the first un-journaled call and everything after runs
  live. Same-script guarantee enforced by comparing `script.snapshot`
  (`JournalCorrupt` on mismatch).
- **Pause (`p`) / Stop (`x`) / Restart (`r`):** the runner holds an `AbortController`
  per in-flight agent. Pause stops scheduling new agents; completed work is already
  journaled so nothing is lost. Stop aborts a single agent or the whole run. Restart
  discards one agent's journal record and re-spawns it.
- **Background + reattach:** `workflow run --detach` forks a detached runner process
  writing to the run dir; `workflow watch <id>` / `workflow list` read the registry
  and tail `events.jsonl`.

**Intentional divergence:** Claude Code resume works only within the same session;
because we persist the journal to disk, **our resume survives across terminal
sessions and reboots** (kept — a natural win from the file registry).

## 8. The Ink TUI (`@workflow/ui`)

The UI is a **pure function of the event stream** — it renders `events.jsonl`
whether the run is live (in-process subscription) or watched/replayed (tailing the
file). One component tree serves `run`, `watch`, and replay, and stays in sync with
resume because both read the same log.

**Layout: Miller-columns / master-detail (persistent side-by-side panes).**

```
┌ deep-research · running · 318k tok · 2m41s · adapter:codex ─────────────────────────┐
│ PHASES            │ AGENTS (Search)        │ research:angle-2  ·  running  ·  44k    │
│ ▸ Scope     1/1   │   ✓ angle-0      18k   │ ─────────────────────────────────────  │
│ ▸ Search    3/5 ⠙ │   ✓ angle-1      22k   │ PROMPT                                  │
│   Verify    0/15  │ ▸ ⠙ angle-2      44k   │  Search the web for recent changes to…  │
│   Synthesize 0/1  │   ⠙ angle-3      —     │                                         │
│                   │   ▱ angle-4   queued   │ TOOL CALLS                              │
│                   │                        │  • WebSearch "node permission v22"      │
│                   │                        │  • WebFetch nodejs.org/api/…            │
│                   │                        │ RESULT (streaming…)                  ⠙  │
│                   │                        │  [ {text:"--experimental-permission…    │
└───────────────────┴────────────────────────┴────────── j/k scroll ──────────────────┘
 ←→ move column · ↑↓ select · p pause · x stop · r restart · s save
```

- **Left — phases:** always visible, live counts/spinner; `↑`/`↓` selects.
- **Middle — agents of the selected phase:** updates as the phase selection moves;
  `→` focuses it, `↑`/`↓` selects an agent.
- **Right — live detail of the selected agent:** prompt, tool calls, streaming result,
  updating in real time; `j`/`k` scroll whenever it overflows, regardless of focus.
- **`←`/`→`** move focus between columns; **`Esc`** jumps focus back to phases.

You can park selection on a running agent and watch its output stream into the right
pane while the left columns keep ticking — no drill-in/back-out.

### Keybindings (full parity)

| Key | Action |
|---|---|
| `↑`/`↓` | select phase or agent |
| `←`/`→` | move focus between columns (right = drill toward detail) |
| `Esc` | focus back to phases column |
| `j`/`k` | scroll the right detail pane |
| `p` | pause / resume the run |
| `x` | stop selected agent, or whole run when focus is on phases |
| `r` | restart selected running agent |
| `s` | save the run's script as a command (save dialog) |

### Rendering concerns

Throttle re-renders to ~10fps and coalesce events (a 1000-agent run is noisy);
virtualize long agent lists; degrade to a plain line-log when stdout isn't a TTY
(CI-friendly fallback).

## 9. CLI surface, consent, config & bundled workflows

```
workflow run <script> [--args '{...}'] [--adapter codex] [--detach] [--model ...] [--yes]
workflow watch <id>            # attach the Ink columns UI to a running/finished run
workflow list                  # registry: running + completed (status/tokens/elapsed)
workflow resume <id>           # replay journal, run the rest live
workflow stop <id>             # stop a backgrounded run
workflow save <id>             # save script as a command (also `s` in the UI)
workflow adapters              # list detected harnesses + capability matrix
workflow <name> [args...]      # run a saved/bundled workflow by name
```

**Saved-workflow resolution:** `.workflow/workflows/<name>.{ts,js}` (project, shared)
then `~/.workflow/workflows/` (personal); **project wins on name collision**.

**Consent before a run (parity):** the CLI prints `meta.name` + the phase list + a
token-cost caution and asks: **Yes** / **Yes, don't ask again for `<name>` in this
project** (records consent in config) / **View script** / **No**. Non-interactive
contexts (`--yes`, no TTY, CI) skip the prompt. The script gets no fs/shell; spawned
agents inherit the adapter's permission posture (`--full-auto` for codex,
`--allow-all-tools` for copilot, etc.).

**Config** — `~/.workflow/config.json` + project `.workflow/config.json`:
`defaultAdapter`, `concurrency` (capped at `min(16, cores−2)`), `maxAgents` (≤1000),
`disableWorkflows`, `adapters.<id>.{bin,extraArgs,model}` overrides, recorded
`dontAskAgain` consents. `WORKFLOW_DISABLE=1` env mirror.

**Bundled workflows** — ship `deep-research.ts` (scope → parallel search →
fetch/dedupe → adversarial 3-vote verify → synthesize) and `vue-newsletter.ts`,
both ported from the source post. They double as e2e targets and living docs.

## 10. Functional style & errors-as-types

- **Pure core, effects at the edges.** `@workflow/core` is pure: immutable `readonly`
  data, discriminated-union state, the event→UI-state mapping as a pure reducer,
  composition over classes. Process spawning, fs writes, and the registry live in the
  runner/CLI edge.
- **No throwing across module boundaries.** Every fallible operation returns
  `Result<T, WorkflowError>` via **`neverthrow`** (`Result`/`ResultAsync`,
  `map`/`andThen`/`match`). `WorkflowError` is a discriminated union:

```ts
type WorkflowError =
  | { kind: 'AdapterSpawn';      adapter: string; cause: string }
  | { kind: 'SchemaValidation';  issues: readonly string[]; attempts: number }
  | { kind: 'SandboxViolation';  api: string }
  | { kind: 'JournalCorrupt';    runId: string; detail: string }
  | { kind: 'BudgetExhausted';   spent: number; total: number }
  | { kind: 'AgentCapExceeded';  cap: number }
```

- **Authoring boundary stays parity-faithful.** Scripts keep Claude Code ergonomics:
  `agent()` resolves the value, `parallel` maps failures to `null`, a thrown error
  aborts the run. The **sandbox boundary** is the single place that unwraps the
  internal `Result` into value/throw — authors never pattern-match. Result-as-types
  governs all library code beneath that boundary.
- **Tooling:** **oxlint** (correctness + restriction rules reinforcing immutability:
  `no-param-reassign`, `prefer-const`, no implicit `any`, …) in CI and a pre-commit
  hook, paired with `tsc --strict` for type-level checks oxlint doesn't cover.

## 11. Testing strategy (Vitest)

The `AgentRunner` seam makes ~95% of the code testable for free and deterministically.
Only actual model intelligence costs money, isolated to one opt-in suite.

**Default suite (runs every commit, zero API cost):**

1. **Unit** — pure logic, no I/O: Zod↔JSON-Schema bridge, validate/retry, the
   concurrency semaphore, journal serialization + key generation, sandbox guards
   (assert `Date.now()`/`Math.random()` throw in the vm), budget accounting, the
   event→UI-state reducer.
2. **Engine integration (the heart)** — drive the whole orchestrator with an
   in-memory **`ScriptedRunner`** (an `AgentRunner` mapping prompt/label → canned
   results via controllable deferred promises). Proves real behavior with no model:
   - `parallel` is a barrier; `pipeline` has none (item A in stage 3 while B in stage 1)
   - resume returns journaled results instantly, then runs the rest live
   - never more than `min(16, cores−2)` agents in flight (assert via the runner's live count)
   - failed thunks → `null`; the 1000-agent cap aborts; `budget` exhaustion errors;
     nested `workflow()` shares the parent semaphore
3. **Adapter contract tests** — command construction + output parsing tested **without
   invoking the real CLI**. (a) assert each adapter builds the exact argv
   (codex → `exec --json --output-schema … -o … --full-auto`); (b) replay recorded
   **golden JSONL fixtures** of real `codex`/`copilot`/`claude` output through the
   parser and assert extracted text/usage/toolCalls. A `WORKFLOW_RECORD=1` helper
   captures fixtures from the real CLIs once, keeping parsers honest with no per-run cost.
4. **UI** — render the Ink columns component with `ink-testing-library` against a
   fixture event stream; assert frames and simulate keypresses (`→` into agents,
   `j`/`k` scroll, `p` pause) against `lastFrame()`.

**End-to-end (real, opt-in, costs money — run from time to time):**

5. **`*.e2e.test.ts`** — a separate Vitest project **excluded from the default run**,
   gated behind `WORKFLOW_E2E=1`, invoked via `pnpm test:e2e`. Runs a tiny real
   workflow (1–3 agents, cheapest model, minimal tokens) through each **installed**
   adapter and asserts: structured output validates, the journal is written, a
   stop→`resume` reuses cached results, and `workflow adapters` detects present
   harnesses. Auto-skips adapters whose CLI isn't on `$PATH`.

**Vitest config: projects.** `unit`, `integration`, `adapter-contract`, `ui` run by
default (`pnpm test`); `e2e` only via `pnpm test:e2e`. v8 coverage on the first four.

## 12. End-to-end shape

```
@workflow/core      sandbox + primitives + scheduler + journal/resume + budget + event bus (pure)
@workflow/schema    Zod ↔ JSON-Schema + validate/retry
@workflow/adapters  AgentRunner + claude/codex/copilot/raw-api + generic-template (effects)
@workflow/ui        Ink columns UI driven by the event stream (pure render)
@workflow/cli       `workflow` bin, run registry, consent, config, bundled workflows (effects)
```

## 13. Open items for the implementation plan

- Confirm the exact JSONL event shapes for `codex --json` and `copilot --output-format
  json` by capturing real fixtures (`WORKFLOW_RECORD=1`) before finalizing parsers.
- Confirm `claude -p --output-format stream-json` tool-forcing schema mechanics
  against the installed Claude Code version.
- Decide the final npm scope/name (placeholder `@workflow/*` — rename before publish).
- Pick `N` for schema validate/retry (default proposal: 2).
