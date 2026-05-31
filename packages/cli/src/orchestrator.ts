import { ok, err, type Result } from "neverthrow";
import {
  createRuntime,
  createSemaphore,
  WorkflowThrow,
  type AgentRunner,
  type ControlRegistry,
  type Immutable,
  type JsonValue,
  type Journal,
  type RunId,
  type RuntimeDeps,
  type WorkflowError,
  type WorkflowEvent,
} from "@workflow/core";
import { loadWorkflow } from "./loader.js";

export interface RunWorkflowDeps {
  readonly source: string;
  readonly args: Immutable<JsonValue>;
  readonly runner: AgentRunner;
  readonly runId: RunId;
  readonly cwd: string;
  readonly concurrency: number;
  readonly maxAgents: number;
  readonly budgetTotal: number | null;
  readonly journal: Journal;
  readonly emit: (event: WorkflowEvent) => void;
  readonly now: () => number;
  readonly signal?: AbortSignal | undefined;
  readonly control?: ControlRegistry | undefined;
  readonly gate?: (() => Promise<void>) | undefined;
  readonly resolveWorkflow?: RuntimeDeps["resolveWorkflow"] | undefined;
  readonly resolveRunner?: RuntimeDeps["resolveRunner"] | undefined;
  readonly makeIsolatedCwd?: RuntimeDeps["makeIsolatedCwd"] | undefined;
  readonly askUser?: RuntimeDeps["askUser"] | undefined;
}

export interface RunResult {
  readonly returnValue: unknown;
  readonly status: "finished";
  /** The workflow's declared `meta.output`, if any — where to persist artifacts. */
  readonly output: string | undefined;
}

/**
 * Compose the loader + core runtime into a single run: load the script, build the
 * runtime over a semaphore/journal/budget, run the body in the sandbox, and emit
 * `run-started`/`run-finished` around it. Persistence and live UI are the caller's
 * concern (wired via `journal` + `emit`). Returns the script's value, or the underlying
 * `WorkflowError` when the run throws — `run-finished` is always emitted so watchers stop.
 */
export async function runWorkflow(
  deps: RunWorkflowDeps,
): Promise<Result<RunResult, WorkflowError>> {
  const loaded = loadWorkflow(deps.source);
  deps.emit({
    type: "run-started",
    runId: deps.runId,
    name: loaded.meta.name,
    budgetTotal: deps.budgetTotal,
    at: deps.now(),
  });

  // Seed the declared phases so the UI shows the full pipeline upfront, in order —
  // not just the phases the script has reached. A long `await` (e.g. parallel research)
  // otherwise leaves later `phase()` calls unrun, so the PHASES pane would show only one.
  for (const p of loaded.meta.phases ?? []) {
    const title = typeof p === "object" && p !== null && "title" in p ? String(p.title) : "";
    if (title) deps.emit({ type: "phase-started", phase: title, at: deps.now() });
  }

  const runtime = createRuntime({
    runner: deps.runner,
    semaphore: createSemaphore(deps.concurrency),
    journal: deps.journal,
    maxAgents: deps.maxAgents,
    budgetTotal: deps.budgetTotal,
    args: deps.args,
    cwd: deps.cwd,
    runId: deps.runId,
    emit: deps.emit,
    now: deps.now,
    ...(deps.signal ? { signal: deps.signal } : {}),
    ...(deps.control ? { control: deps.control } : {}),
    ...(deps.gate ? { gate: deps.gate } : {}),
    ...(deps.resolveWorkflow ? { resolveWorkflow: deps.resolveWorkflow } : {}),
    ...(deps.resolveRunner ? { resolveRunner: deps.resolveRunner } : {}),
    ...(deps.makeIsolatedCwd ? { makeIsolatedCwd: deps.makeIsolatedCwd } : {}),
    ...(deps.askUser ? { askUser: deps.askUser } : {}),
  });

  try {
    const returnValue = await loaded.run(runtime, deps.args);
    deps.emit({ type: "run-finished", runId: deps.runId, at: deps.now() });
    return ok({ returnValue, status: "finished", output: loaded.meta.output });
  } catch (e) {
    deps.emit({ type: "run-finished", runId: deps.runId, at: deps.now() });
    const error: WorkflowError =
      e instanceof WorkflowThrow
        ? e.workflowError
        : { kind: "AdapterSpawn", adapter: "run", cause: String(e) };
    return err(error);
  }
}
