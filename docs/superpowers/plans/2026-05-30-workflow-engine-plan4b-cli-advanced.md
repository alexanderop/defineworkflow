# Workflow Engine — Plan 4b: `@workflow/cli` advanced (parity gaps + bundled workflows + e2e)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Follow TDD (red → green → commit) as in Plans 1–4a. Run `pnpm test` (free, deterministic) every cycle; the new `*.e2e.test.ts` suite is opt-in via `pnpm test:e2e`.

## Context

Plan 4a shipped the core CLI (`workflow run/watch/list/resume/stop/save/adapters`, the
`~/.workflow/runs/<id>/` registry, journaling/resume, consent, config, detached
background runs). It deliberately deferred four feature-parity items plus the real-CLI
e2e suite, and left one wire unconnected. **Plan 4b closes those gaps.**

What 4a left undone (verified against the code):

1. **Nested `workflow()` does not work yet.** `runWorkflow` accepts `resolveWorkflow`
   (`packages/cli/src/orchestrator.ts`) but neither the `run`/`resume`/detached paths nor
   `runForeground`/`runHeadless` (`packages/cli/src/execute.ts`) ever pass it, so a script
   calling `workflow("name")` throws `AdapterSpawn: no workflow resolver configured`
   (`packages/core/src/runtime.ts:174`). Bundled workflows that compose need this.
2. **Per-call `{adapter}` override is ignored.** `AgentOptions.adapter` exists
   (`packages/core/src/runtime.ts:16`) but `agent()` always calls the single
   `deps.runner` (`runtime.ts:132`). Design §6 precedence ("per-call → meta → CLI →
   config → auto-detect") is therefore unmet at the per-call level — 4a's
   `selectAdapterId` intentionally drops it (`packages/cli/src/adapter-select.ts`).
3. **Stop is run-scoped only; restart is a no-op.** 4a wires the UI's
   `stop {scope:'agent'}` and `restart` actions to a `log` line
   (`packages/cli/src/execute.ts`) because the runtime has no per-agent control handle.
4. **`isolation: 'worktree'` is unimplemented.** The option is accepted
   (`runtime.ts:17`) but never acted on; every agent runs in `deps.cwd`.
5. **No real-CLI e2e.** The `e2e` vitest project exists (`vitest.workspace.ts`) and
   `pnpm test:e2e` is wired, but there are zero `*.e2e.test.ts` files.

**Outcome:** composing/bundled workflows run (`workflow deep-research --args …`), an
`agent(..., { adapter: 'codex' })` call reaches codex even when the run default is
claude, `x` on a selected running agent stops just that agent while `r` restarts it,
`isolation:'worktree'` runs an agent in an isolated git worktree, and a gated e2e suite
exercises each installed harness end-to-end.

## Architecture

Three of the five items require **small, additive `@workflow/core` extensions** (Phase 0),
mirroring how 4a added `signal`/`gate`. All keep existing core tests green by defaulting
to today's behaviour. The CLI then wires them (Phase 1), ships bundled workflows
(Phase 2), and adds the opt-in e2e suite (Phase 3).

```
Phase 0 (core, additive)                 Phase 1 (cli wiring)
─ runner resolver  (per-call adapter)  → build an adapter map; resolveRunner in execute
─ AgentControl     (stop/restart 1 agent) → UI onAction → control.stopAgent/restartAgent
─ worktree hook    (isolation)         → git worktree add/remove via ProcessRunner
                                        → pass resolveWorkflow into every run (nested wf)
Phase 2  examples/deep-research.ts + vue-newsletter.ts + bundled resolution
Phase 3  packages/cli/src/*.e2e.test.ts (WORKFLOW_E2E=1), per-installed-adapter
```

**Dependency rule unchanged:** core stays pure (the worktree hook is an injected
function, not fs/git itself); the CLI owns all git/process/fs effects.

> **Strict-mode reminders** (`tsconfig.base.json`): `import type` for type-only imports;
> optional-and-`undefined` props typed `x?: T | undefined`; guard every index access;
> `neverthrow` `Result` stays internal. Determinism guard is unchanged — bundled
> workflows must not call `Date.now`/`Math.random`.

---

## Phase 0 — Core extensions (additive, all existing tests stay green)

### Task 1: Per-call adapter dispatch (`resolveRunner`)

Let a script pick a harness per `agent()` call without changing the run default.

**Files:** Modify `packages/core/src/runtime.ts`; test `packages/core/src/runtime.test.ts`.

- [ ] **Step 1 (red):** In `runtime.test.ts`, build a runtime with `deps.runner` = scripted
  runner A and `deps.resolveRunner = (id) => id === "b" ? runnerB : undefined`. Assert
  `agent("p", { label: "x", adapter: "b" })` routes to `runnerB` (its `callCount` increments,
  A's stays 0), and that an unknown adapter id falls back to `deps.runner`.

- [ ] **Step 2:** Run → FAIL (`resolveRunner` not on `RuntimeDeps`).

- [ ] **Step 3 (green):** Add `readonly resolveRunner?: ((id: string) => AgentRunner | undefined) | undefined;`
  to `RuntimeDeps`. In `agent()`, just before `deps.runner.run(...)` (`runtime.ts:132`):
  ```ts
  const runner = opts.adapter ? (deps.resolveRunner?.(opts.adapter) ?? deps.runner) : deps.runner;
  const result = await runner.run(request, { runId: deps.runId, seq: mySeq });
  ```

- [ ] **Step 4–5:** Run new test + `pnpm vitest run packages/core` → green. Commit
  `feat(core): per-call adapter dispatch via resolveRunner`.

### Task 2: Agent-scoped control (`AgentControl`: stop + restart a single agent)

Expose a per-agent control handle so the UI can stop or restart one running agent. Done
by registering each in-flight agent's `AbortController` under its `key`, and looping the
agent on a restart request.

**Files:** Modify `packages/core/src/runtime.ts`, export a new `control.ts`; tests in `packages/core/src/runtime.control.test.ts`.

- [ ] **Step 1 (red):** New `runtime.control.test.ts` using a **deferred** scripted runner
  (`createScriptedRunner(resp, { delayMs })` or a controllable runner) so the agent is
  observably in-flight:
  - `control.stopAgent(key)` aborts that agent → its `agent()` rejects with
    `{kind:"AdapterSpawn", cause:"agent stopped"}`, emits `agent-failed`, and **other**
    in-flight agents are unaffected.
  - `control.restartAgent(key)` re-invokes the runner for that key (assert `callCount`
    goes 1→2 for that label) and resolves with the second result; no `agent-failed` is
    emitted for a successful restart.

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3 (green):** Add `control.ts`:
  ```ts
  export interface AgentControl {
    stopAgent(key: string): void;
    restartAgent(key: string): void;
  }
  export interface ControlRegistry extends AgentControl {
    register(key: string, controller: AbortController, requestRestart: () => void): () => void;
  }
  export function createControlRegistry(): ControlRegistry { /* Map<key,{controller,requestRestart}> */ }
  ```
  Add `readonly control?: ControlRegistry | undefined;` to `RuntimeDeps`. Rework the
  in-flight section of `agent()` (around `runtime.ts:118–155`) into a restart loop:
  ```ts
  for (;;) {
    const controller = new AbortController();
    let restart = false;
    const signal = deps.signal ? anySignal([deps.signal, controller.signal]) : controller.signal;
    const unregister = deps.control?.register(key, controller, () => { restart = true; });
    deps.emit({ type: "agent-started", key, at: deps.now() });
    try {
      const result = await runner.run({ ...request, signal }, { runId: deps.runId, seq: mySeq });
      // …existing success path (tools, validate, budget, journal, agent-output, agent-finished)…
      return value;
    } catch (e) {
      if (restart) continue;            // restartAgent: re-run, same key/seq
      throw e;                           // stop/real failure: propagate (parallel nulls it)
    } finally {
      unregister?.();
    }
  }
  ```
  `anySignal` = `AbortSignal.any` (Node ≥20) wrapped in a tiny helper. `stopAgent`
  aborts without setting `restart` (→ throws); `restartAgent` sets the flag then aborts
  (→ loops). Keep the `agent-started` emit inside the loop so a restart re-emits start.

- [ ] **Step 4–5:** New tests + full `pnpm vitest run packages/core` green. Export
  `AgentControl`/`createControlRegistry` from `packages/core/src/index.ts`. Commit
  `feat(core): per-agent stop/restart via AgentControl registry`.

> **Note:** restart is only meaningful **while the agent is in flight** (the script is
> still awaiting it). A completed/journaled agent cannot be restarted from the UI in 4b;
> that would need journal-record rollback + script re-entry (out of scope).

### Task 3: Worktree isolation hook

Keep core pure: inject a function that produces an isolated cwd; the CLI implements it
with git.

**Files:** Modify `packages/core/src/runtime.ts`; test `packages/core/src/runtime.test.ts`.

- [ ] **Step 1 (red):** Assert that with `deps.makeIsolatedCwd = async (key) => ({ cwd:"/wt/"+key, cleanup })`,
  an `agent("p", { label:"a", isolation:"worktree" })` call passes `cwd:"/wt/0:default:a"`
  to the runner (capture via a runner that records `req.cwd`) and calls `cleanup` once
  after finishing. Without `isolation`, the runner sees `deps.cwd` and `cleanup` is never built.

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3 (green):** Add
  `readonly makeIsolatedCwd?: ((key: string) => Promise<{ cwd: string; cleanup: () => Promise<void> }>) | undefined;`
  to `RuntimeDeps`. In `agent()`, when `opts.isolation === "worktree" && deps.makeIsolatedCwd`,
  acquire `{cwd, cleanup}` after the semaphore, use `cwd` in the `AgentRequest`, and
  `await cleanup()` in a `finally`. Otherwise use `deps.cwd` as today.

- [ ] **Step 4–5:** Green + full core suite. Commit `feat(core): worktree isolation hook (makeIsolatedCwd)`.

---

## Phase 1 — CLI wiring

### Task 4: Wire the nested-workflow resolver into every run

Make `workflow()` work by giving the runtime a resolver built from `resolveSavedWorkflow`
+ `loadWorkflow`.

**Files:** Modify `packages/cli/src/execute.ts` (both run paths), add `packages/cli/src/resolve-workflow.ts`; test `packages/cli/src/resolve-workflow.test.ts`.

- [ ] Add `buildWorkflowResolver(deps): RuntimeDeps["resolveWorkflow"]` that, given a name,
  calls `resolveSavedWorkflow(name, { homeDir, cwd, readFile: deps.readTextFile })`
  (plus the bundled dir from Task 8), and returns `loadWorkflow(resolved.source)`; throws a
  clear error on miss. Pass it as `resolveWorkflow` in both `runForeground` and
  `runHeadless` `runWorkflow({...})` calls. Test with a fake `readTextFile` + a
  `ScriptedRunner`: a parent script that calls `await workflow("child")` runs the child
  and returns its value (one real engine integration, no model).

### Task 5: Per-call adapter map (`resolveRunner`) in the CLI

**Files:** Modify `packages/cli/src/adapter-select.ts`, `packages/cli/src/execute.ts`; tests alongside.

- [ ] Add `buildRunnerMap(detected, cfg, deps): { resolveRunner, ids }` that lazily
  builds (and memoises) a runner per adapter id via `buildRunner`, skipping ones that
  error (e.g. raw-api without a key). Thread `resolveRunner` into both `runWorkflow` calls
  in `execute.ts`, and restore the per-call branch of design §6 in `selectAdapterId`'s
  doc (the run default still comes from meta/CLI/config/detect; per-call now overrides via
  the map). Test: a runner map routes id→runner; an un-buildable id is absent.

### Task 6: Agent stop/restart UI actions

Replace 4a's "not supported yet" log lines with real control.

**Files:** Modify `packages/cli/src/execute.ts`; extend `packages/cli/src/commands/commands.test.ts`.

- [ ] In `runForeground`, create `const control = createControlRegistry()` and pass it in
  `runWorkflow({ ..., control })` (thread `control` through `RunWorkflowDeps` →
  `createRuntime`). The UI `onAction` already carries the agent `key` for
  `stop {scope:'agent', key}` and `restart {key}`; map them to `control.stopAgent(key)` /
  `control.restartAgent(key)` (keep `stop {scope:'run'}` → `controller.abort()`). Test via
  a scripted/deferred runner that an agent-scope stop fails just that agent (others
  finish) and a restart yields a second runner call.

### Task 7: Git worktree implementation (`makeIsolatedCwd`)

**Files:** Add `packages/cli/src/worktree.ts`; test `packages/cli/src/worktree.test.ts`; wire in `packages/cli/src/execute.ts` + `node-deps.ts`.

- [ ] `createWorktreeFactory({ processRunner, baseCwd, tmpRoot, runId })` returns
  `makeIsolatedCwd(key)` that runs `git -C <baseCwd> worktree add --detach <tmpRoot>/<runId>/<safeKey>`
  via the injected `ProcessRunner`, returning `{ cwd, cleanup }` where `cleanup` runs
  `git worktree remove --force <path>`. Test argv construction + cleanup with a
  `FakeProcessRunner` (assert the exact `git worktree add/remove` commands; no real git).
  Thread `makeIsolatedCwd` into `runWorkflow` (foreground + headless) and build it in
  `node-deps.ts` (tmp root under `os.tmpdir()`). Gracefully degrade (warn + use base cwd)
  when `baseCwd` is not a git repo.

---

## Phase 2 — Bundled workflows

### Task 8: Ship `deep-research.ts` + `vue-newsletter.ts` and resolve them by name

**Files:** Add `examples/deep-research.ts`, `examples/vue-newsletter.ts`,
`examples/package.json` (already in the `pnpm-workspace.yaml` glob); modify
`packages/cli/src/resolve.ts` to add a bundled fallback; test `packages/cli/src/resolve.test.ts`.

- [ ] Port both workflows from the design post (design §9): `deep-research` =
  scope → parallel search → dedupe → adversarial 3-vote verify → synthesize, using
  `phase`/`agent`/`parallel`/budget loops and Zod schemas (importable types only — they run
  as injected globals). `vue-newsletter` = the multi-source aggregation shape. Keep them
  determinism-clean (no `Date.now`/`Math.random`).
- [ ] Extend `resolveSavedWorkflow` precedence to: project `.workflow/workflows/` →
  personal `~/.workflow/workflows/` → **bundled** (`<pkgRoot>/examples/<name>.{ts,js}`).
  Inject the bundled dir path (resolved from the CLI's install location) so it's testable.
  Test: a bundled name resolves when no project/personal copy exists; project still wins.
- [ ] Manual: `workflow deep-research --args '{"question":"…"}' --yes` runs against a
  detected adapter (small/cheap), and `workflow list` shows it.

---

## Phase 3 — Opt-in real-CLI e2e

### Task 9: `*.e2e.test.ts` per installed adapter (gated by `WORKFLOW_E2E=1`)

**Files:** Add `packages/cli/src/e2e.e2e.test.ts` (matched by the existing `e2e` vitest project).

- [ ] For each id in `await detectAdapters()` (auto-skip with `it.skipIf` when absent and
  when `process.env.WORKFLOW_E2E !== "1"`), run a tiny 1-agent workflow through the real
  CLI path (build real `AppDeps` or invoke `dist/cli.js` via `child_process`) and assert:
  - structured output validates against a Zod schema (use a schema-bearing agent),
  - `~/.workflow/runs/<id>/journal.jsonl` is written,
  - a `stop` → `resume` reuses cached results (second run makes no new adapter spawn —
    assert via elapsed/no-new-tokens or a journal-hit marker),
  - `workflow adapters` lists the present harness.
  Use the cheapest model and minimal tokens. Document `pnpm test:e2e` in the package README.
- [ ] (Optional) `WORKFLOW_RECORD=1` helper to capture adapter golden fixtures (design §13)
  — note as a follow-up if not done here.

---

## Verification

- **Free suite (`pnpm test`), every cycle:** Phase 0 core extensions (per-call dispatch,
  stop/restart control, worktree hook), Phase 1 wiring (nested resolver runs a child,
  runner map routing, agent stop/restart via a deferred scripted runner, worktree argv via
  `FakeProcessRunner`), Phase 2 bundled resolution precedence.
- **Typecheck/lint:** `pnpm typecheck` + `pnpm lint` clean across all 5 packages.
- **Manual:** `workflow deep-research --args '{…}' --yes` end-to-end; an
  `agent(..., {adapter:'codex'})` line in a test script reaches codex while the run default
  is claude; `x`/`r` on a selected running agent in the TUI stop/restart just that agent;
  an `isolation:'worktree'` agent runs in a fresh worktree that is removed afterward.
- **e2e (opt-in):** `pnpm test:e2e` (with `WORKFLOW_E2E=1`) against whatever harnesses are
  installed; auto-skips the rest.
- **Determinism unchanged:** bundled workflows and worktree paths still reject
  `Date.now()`/`Math.random()` (sandbox guard untouched).

## Out of scope (future)

- Restarting an **already-completed/journaled** agent (needs journal-record rollback +
  script re-entry).
- Per-call adapter selection inside nested `workflow()` beyond one level (nesting stays
  one level deep, per design §5).
- Hosted/remote execution backend and a long-lived daemon (design non-goals).
