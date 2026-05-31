import { validate, compileValidator, isZodSchema, toJsonSchema, type JsonSchema, type ZodLike } from "@workflow/schema";
import type { AgentKey, RunId } from "./brand.js";
import type { Immutable, JsonValue } from "./type-ext.js";
import { createBudget, type Budget } from "./budget.js";
import { WorkflowThrow, type WorkflowError } from "./errors.js";
import { truncateRawOutput } from "./raw-output.js";
import type { Semaphore } from "./semaphore.js";
import type { Journal } from "./journal.js";
import type { AgentRequest, AgentRunner, WorkflowMeta } from "./types.js";
import type { AgentProgress, WorkflowEvent } from "./events.js";
import type { ControlRegistry } from "./control.js";
import { isProfile, type Profile, type ProfileConfig } from "./profile.js";

/** Derive a readable label from a prompt's first non-empty line (truncated), for unlabeled agents. */
export function labelFromPrompt(prompt: string, max = 48): string {
  const firstLine = prompt.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  if (firstLine === "") return "";
  return firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
}

export interface AgentOptions {
  readonly label?: string;
  readonly phase?: string;
  readonly schema?: JsonSchema | ZodLike;
  readonly model?: string;
  readonly agentType?: string;
  readonly adapter?: string;
  readonly isolation?: "worktree";
  /** A persona / system hint prepended to the request prompt. */
  readonly instructions?: string;
}

/** A question raised mid-run; the resolved `askUser` handler turns it into the user's answer. */
export interface QuestionRequest {
  readonly key: string;
  readonly question: string;
  readonly choices?: readonly string[];
  readonly allowOther?: boolean;
  readonly default?: string;
}

export interface AskUserQuestionOptions {
  /** Stable key for `--answers` and journaling; falls back to a seq/phase/label-derived key. */
  readonly key?: string;
  /** The question text, rendered as markdown in the interactive UI. */
  readonly question: string;
  readonly choices?: readonly string[];
  /** Offer an "Other → type your own" free-text path alongside the choices. */
  readonly allowOther?: boolean;
  /** Answer used in non-interactive runs when no pre-supplied answer matches the key. */
  readonly default?: string;
  readonly label?: string;
  readonly phase?: string;
}

export interface LoadedWorkflow {
  readonly meta: WorkflowMeta;
  run(runtime: Runtime, args?: unknown): Promise<unknown>;
}

export interface RuntimeDeps {
  readonly runner: AgentRunner;
  readonly semaphore: Semaphore;
  readonly journal: Journal;
  readonly maxAgents: number;
  readonly budgetTotal: number | null;
  readonly args: Immutable<JsonValue>;
  readonly cwd: string;
  readonly runId: RunId;
  readonly emit: (event: WorkflowEvent) => void;
  readonly now: () => number;
  readonly resolveWorkflow?: (name: string, args?: unknown) => Promise<LoadedWorkflow>;
  /** Per-call adapter dispatch: return a runner for the given adapter id, or undefined to fall back to deps.runner. */
  readonly resolveRunner?: ((id: string) => AgentRunner | undefined) | undefined;
  /** Run-scoped stop: when aborted, in-flight adapter processes are killed and new agent() calls short-circuit. */
  readonly signal?: AbortSignal | undefined;
  /** Pause gate: awaited before each agent acquires the semaphore (resolves immediately when not paused). */
  readonly gate?: (() => Promise<void>) | undefined;
  /** Per-agent control: registers each in-flight agent's AbortController under its key for stop/restart. */
  readonly control?: ControlRegistry | undefined;
  /** Worktree isolation: produce an isolated working directory for a given agent key; cleaned up after the agent finishes. */
  readonly makeIsolatedCwd?: ((key: AgentKey) => Promise<{ cwd: string; cleanup: () => Promise<void> }>) | undefined;
  /** Human-in-the-loop: resolve a mid-run question to the user's answer. Required for askUserQuestion(). */
  readonly askUser?: ((req: QuestionRequest) => Promise<string>) | undefined;
}

export interface Runtime {
  readonly args: Immutable<JsonValue>;
  readonly budget: Budget;
  agent(prompt: string, opts?: AgentOptions): Promise<unknown>;
  agent(profile: Profile, prompt: string, opts?: AgentOptions): Promise<unknown>;
  parallel<T>(thunks: ReadonlyArray<() => Promise<T>>): Promise<Array<T | null>>;
  pipeline(items: readonly unknown[], ...stages: ReadonlyArray<(prev: unknown, item: unknown, index: number) => Promise<unknown>>): Promise<Array<unknown | null>>;
  phase(title: string): void;
  log(message: string): void;
  workflow(name: string, args?: Immutable<JsonValue>): Promise<unknown>;
  askUserQuestion(opts: AskUserQuestionOptions): Promise<string>;
}

/** The fields a {@link ProfileConfig} may set — also the keys a call site can override. */
const PROFILE_CONFIG_KEYS = ["adapter", "model", "agentType", "isolation", "instructions"] as const satisfies ReadonlyArray<keyof ProfileConfig>;

/** Keys a call site re-specified that the profile already set with a different value. */
function profileOverrides(config: ProfileConfig, callOpts: AgentOptions): readonly string[] | undefined {
  const keys = PROFILE_CONFIG_KEYS.filter(
    (k) => config[k] !== undefined && callOpts[k] !== undefined && callOpts[k] !== config[k],
  );
  return keys.length > 0 ? keys : undefined;
}

/**
 * Coerce a non-zod `agent({ schema })` value to a plain JSON Schema object. `isZodSchema` is a type
 * predicate, so its false branch already narrows the input to `JsonSchema` here — no comment-only
 * invariant; the spread just copies its own enumerable keys.
 */
function toJsonSchemaObject(value: JsonSchema): JsonSchema {
  return { ...value };
}

export function createRuntime(deps: RuntimeDeps): Runtime {
  const budget = createBudget(deps.budgetTotal);
  let currentPhase = "default";
  let seq = 0;
  let spawned = 0;
  // Tail of the question lock chain — each askUserQuestion() awaits the prior question before
  // prompting, so only one prompt is ever open even when raised inside parallel()/pipeline().
  let questionTail: Promise<void> = Promise.resolve();

  const agent = async (
    a: string | Profile,
    b?: string | AgentOptions,
    c?: AgentOptions,
  ): Promise<unknown> => {
    // Resolve the two call shapes — agent(prompt, opts) and agent(profile, prompt, opts) —
    // into a single (prompt, opts). A profile is static config merged *before* the request
    // is built, so call-site opts win and everything downstream is unchanged.
    let prompt: string;
    let opts: AgentOptions;
    let overrides: readonly string[] | undefined;
    if (isProfile(a)) {
      prompt = typeof b === "string" ? b : "";
      const callOpts = c ?? {};
      overrides = profileOverrides(a.config, callOpts);
      opts = { ...a.config, ...callOpts };
    } else {
      prompt = a;
      opts = typeof b === "object" ? b : {};
    }

    const mySeq = seq++;
    const phase = opts.phase ?? currentPhase;
    const label = opts.label ?? (labelFromPrompt(prompt) || `agent-${mySeq}`);
    // oxlint-disable-next-line typescript/consistent-type-assertions -- branded AgentKey mint; the composite identity carries the brand only here
    const key = `${mySeq}:${phase}:${label}` as AgentKey;
    // instructions is a config-level system hint, folded into the request prompt only —
    // after label/key derivation, so it never changes an agent's identity.
    const requestPrompt = opts.instructions ? `${opts.instructions}\n\n${prompt}` : prompt;

    // Live progress sink: tool calls become `agent-tool`; token/model updates become
    // `agent-progress`, coalesced to ≤1/sec. Tokens are tracked monotonically and the
    // last seen model is carried into `agent-finished`. The first update always emits
    // (lastProgressAt seeded to -Infinity).
    let lastProgressAt = Number.NEGATIVE_INFINITY;
    let lastModel: string | undefined;
    let maxTokens = 0;
    const onProgress = (p: AgentProgress): void => {
      if (p.tool) deps.emit({ type: "agent-tool", key, tool: p.tool, at: deps.now() });
      if (p.model !== undefined) lastModel = p.model;
      if (p.tokens !== undefined) maxTokens = Math.max(maxTokens, p.tokens);
      if (p.tokens === undefined && p.model === undefined) return;
      const at = deps.now();
      if (at - lastProgressAt < 1000) return; // coalesce
      lastProgressAt = at;
      // Always carry the best-known token count (not just when this update had one),
      // so a model-only update still flushes any tokens coalesced since the last emit.
      deps.emit({
        type: "agent-progress",
        key,
        ...(maxTokens > 0 ? { tokens: maxTokens } : {}),
        ...(lastModel !== undefined ? { model: lastModel } : {}),
        at,
      });
    };

    deps.emit({ type: "agent-queued", key, label, phase, prompt, ...(overrides ? { overrides } : {}), at: deps.now() });

    // Run-scoped stop: a fired signal short-circuits before any work is scheduled.
    if (deps.signal?.aborted) {
      const e: WorkflowError = { kind: "AdapterSpawn", adapter: "run", cause: "run stopped" };
      deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
      throw new WorkflowThrow(e);
    }

    // Resume: journal hit returns cached result without spawning.
    const cached = deps.journal.lookup(mySeq);
    if (cached) {
      budget.record(cached.outputTokens);
      deps.emit({ type: "agent-output", key, chunk: cached.text, at: deps.now() });
      deps.emit({ type: "agent-finished", key, usage: { inputTokens: 0, outputTokens: cached.outputTokens }, cached: true, at: deps.now() });
      return cached.data ?? cached.text;
    }

    // Budget gate (parity: further agent() calls throw once spent reaches total).
    // Best-effort gate: under concurrency spend may overshoot total by up to (concurrency × per-agent tokens). Spec defines budget as a gate, not a hard reservation.
    if (deps.budgetTotal !== null && budget.remaining() <= 0) {
      const e: WorkflowError = { kind: "BudgetExhausted", spent: budget.spent(), total: deps.budgetTotal };
      deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
      throw new WorkflowThrow(e);
    }

    // Agent cap — claim the slot synchronously so concurrent launches can't overshoot.
    if (spawned >= deps.maxAgents) {
      const e: WorkflowError = { kind: "AgentCapExceeded", cap: deps.maxAgents };
      deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
      throw new WorkflowThrow(e);
    }
    spawned++;

    // `opts.schema` is either a plain JSON Schema or a zod schema; normalize zod to JSON
    // Schema up front (the serializable form harnesses + AJV consume). Compile it here so a
    // malformed schema surfaces as a clean SchemaValidation error rather than an opaque
    // adapter-spawn failure when the adapter later tries to compile it.
    let jsonSchema: JsonSchema | undefined;
    if (opts.schema) {
      try {
        const rawSchema = opts.schema;
        const candidate: JsonSchema = isZodSchema(rawSchema) ? toJsonSchema(rawSchema) : toJsonSchemaObject(rawSchema);
        compileValidator(candidate);
        jsonSchema = candidate;
      } catch (cause) {
        const e: WorkflowError = { kind: "SchemaValidation", issues: [cause instanceof Error ? cause.message : String(cause)], attempts: 0 };
        deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
        throw new WorkflowThrow(e);
      }
    }

    // Pause gate: hold here while paused, then re-check stop (a pause may have spanned a stop).
    if (deps.gate) await deps.gate();
    if (deps.signal?.aborted) {
      const e: WorkflowError = { kind: "AdapterSpawn", adapter: "run", cause: "run stopped" };
      deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
      throw new WorkflowThrow(e);
    }

    const release = await deps.semaphore.acquire();
    try {
      // Acquire the isolated cwd inside the try so a rejecting makeIsolatedCwd still releases
      // the semaphore slot (via the outer finally). The cwd is stable across restart iterations.
      const isolated =
        opts.isolation === "worktree" && deps.makeIsolatedCwd ? await deps.makeIsolatedCwd(key) : undefined;
      const cwd = isolated?.cwd ?? deps.cwd;
      try {
        // Restart loop: a restart request aborts the current run and re-runs with the same
        // key/seq. Restart is only meaningful while the agent is in flight (registered here).
        for (;;) {
          const controller = new AbortController();
          let restart = false;
          // Run-scoped stop and per-agent stop both drive the adapter's AbortSignal.
          const signal = deps.signal ? AbortSignal.any([deps.signal, controller.signal]) : controller.signal;
          const unregister = deps.control?.register(key, controller, () => {
            restart = true;
          });
          // Re-emitted each iteration: a restart is a fresh start for the same key.
          deps.emit({ type: "agent-started", key, at: deps.now() });
          try {
            const request: AgentRequest = {
              prompt: requestPrompt,
              label,
              cwd,
              signal,
              ...(jsonSchema ? { schema: jsonSchema } : {}),
              ...(opts.model ? { model: opts.model } : {}),
              ...(opts.agentType ? { agentType: opts.agentType } : {}),
            };
            const runner = opts.adapter ? (deps.resolveRunner?.(opts.adapter) ?? deps.runner) : deps.runner;
            const result = await runner.run(request, { runId: deps.runId, seq: mySeq, onProgress });

            if (result.isErr()) {
              if (restart) continue; // restartAgent: re-run with a fresh controller, same key/seq.
              deps.emit({ type: "agent-failed", key, error: result.error, at: deps.now() });
              throw new WorkflowThrow(result.error);
            }

            const res = result.value;
            for (const tool of res.toolCalls) deps.emit({ type: "agent-tool", key, tool, at: deps.now() });

            let value: unknown = res.text;
            if (jsonSchema) {
              const validated = validate(jsonSchema, res.data);
              if (validated.isErr()) {
                const e: WorkflowError = {
                  kind: "SchemaValidation",
                  issues: validated.error.kind === "Validation" ? validated.error.issues : ["validation failed"],
                  attempts: 1,
                  rawOutput: truncateRawOutput(res.text),
                };
                deps.emit({ type: "agent-failed", key, error: e, at: deps.now() });
                throw new WorkflowThrow(e);
              }
              value = validated.value;
            }

            budget.record(res.usage.outputTokens);
            deps.journal.record({ seq: mySeq, key, text: res.text, data: res.data, outputTokens: res.usage.outputTokens });
            deps.emit({ type: "agent-output", key, chunk: res.text, at: deps.now() });
            deps.emit({
              type: "agent-finished",
              key,
              usage: res.usage,
              cached: false,
              ...(lastModel !== undefined ? { model: lastModel } : {}),
              at: deps.now(),
            });
            return value;
          } catch (e) {
            if (restart) continue; // restart requested even on a thrown error: re-run.
            throw e; // stop / real failure: propagate (parallel nulls it).
          } finally {
            unregister?.();
          }
        }
      } finally {
        // Best-effort cleanup: a failing worktree removal must not skip release() below
        // (outer finally) nor mask the agent's real result/throw.
        if (isolated) {
          try {
            await isolated.cleanup();
          } catch {
            // ignore: leaked isolated cwd is non-fatal; the CLI factory warns on its own.
          }
        }
      }
    } finally {
      release();
    }
  };

  const parallel = async <T>(thunks: ReadonlyArray<() => Promise<T>>): Promise<Array<T | null>> =>
    Promise.all(thunks.map((t) => t().catch(() => null)));

  const pipeline = async (
    items: readonly unknown[],
    ...stages: ReadonlyArray<(prev: unknown, item: unknown, index: number) => Promise<unknown>>
  ): Promise<Array<unknown | null>> =>
    Promise.all(
      items.map(async (item, index) => {
        let prev: unknown = item;
        try {
          for (const stage of stages) prev = await stage(prev, item, index);
          return prev;
        } catch {
          return null;
        }
      }),
    );

  const askUserQuestion = async (opts: AskUserQuestionOptions): Promise<string> => {
    const mySeq = seq++;
    const phase = opts.phase ?? currentPhase;
    const label = opts.label ?? (labelFromPrompt(opts.question) || `question-${mySeq}`);
    const key = opts.key ?? `${mySeq}:${phase}:${label}`;

    // Serialize prompts: only one question competes for the keyboard at a time. Agents already
    // in flight keep running; concurrent questions queue here in seq (call) order.
    const prior = questionTail;
    let releaseLock!: () => void;
    questionTail = new Promise<void>((res) => {
      releaseLock = res;
    });
    await prior;
    try {
      deps.emit({
        type: "question-asked",
        key,
        question: opts.question,
        ...(opts.choices ? { choices: opts.choices } : {}),
        ...(opts.allowOther !== undefined ? { allowOther: opts.allowOther } : {}),
        at: deps.now(),
      });

      // Resume: a journaled answer returns without re-asking. Questions ride the same seq
      // counter and journal as agent(), but skip the budget/agent-cap gates — a question
      // costs no tokens and is not an agent.
      const cached = deps.journal.lookup(mySeq);
      if (cached) {
        const cachedAnswer = cached.data ?? cached.text;
        const answer = typeof cachedAnswer === "string" ? cachedAnswer : String(cachedAnswer);
        deps.emit({ type: "question-answered", key, answer, cached: true, at: deps.now() });
        return answer;
      }

      if (!deps.askUser) {
        throw new WorkflowThrow({ kind: "AdapterSpawn", adapter: "askUser", cause: "no askUser handler configured" });
      }
      const request: QuestionRequest = {
        key,
        question: opts.question,
        ...(opts.choices ? { choices: opts.choices } : {}),
        ...(opts.allowOther !== undefined ? { allowOther: opts.allowOther } : {}),
        ...(opts.default !== undefined ? { default: opts.default } : {}),
      };
      const answer = await deps.askUser(request);
      deps.journal.record({ seq: mySeq, key, text: answer, data: answer, outputTokens: 0 });
      deps.emit({ type: "question-answered", key, answer, cached: false, at: deps.now() });
      return answer;
    } finally {
      releaseLock();
    }
  };

  const phase = (title: string): void => {
    currentPhase = title;
    deps.emit({ type: "phase-started", phase: title, at: deps.now() });
  };

  const log = (message: string): void => {
    deps.emit({ type: "log", message, at: deps.now() });
  };

  const workflow = async (name: string, childArgs?: Immutable<JsonValue>): Promise<unknown> => {
    if (!deps.resolveWorkflow) {
      throw new WorkflowThrow({ kind: "AdapterSpawn", adapter: "workflow", cause: "no workflow resolver configured" });
    }
    const loaded = await deps.resolveWorkflow(name, childArgs);
    const childRuntime: Runtime = {
      args: childArgs ?? null,
      budget,
      agent,
      parallel,
      pipeline,
      phase,
      log,
      workflow: async () => {
        throw new WorkflowThrow({ kind: "AdapterSpawn", adapter: "workflow", cause: "workflow() nesting is one level only" });
      },
      askUserQuestion,
    };
    return loaded.run(childRuntime, childArgs);
  };

  return { args: deps.args, budget, agent, parallel, pipeline, phase, log, workflow, askUserQuestion };
}
