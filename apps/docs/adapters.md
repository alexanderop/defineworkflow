# Adapters

<p class="wf-eyebrow">packages/adapters</p>

An **adapter** maps the engine's uniform `AgentRequest` onto a specific backend. Each one implements
the same interface:

```ts
interface AgentRunner {
  readonly id: HarnessId;            // "claude" | "codex" | "copilot" | "raw-api"
  readonly capabilities: Capabilities;
  run(req: AgentRequest, ctx: RunContext): Promise<Result<AgentResult, WorkflowError>>;
}
```

The harness is **declared in `meta.harness`** as the run's default backend — there is no auto-detect
and no CLI/config override of it, though individual `agent()` calls can target a different `adapter`
(see [below](#combining-harnesses-in-one-run)). `adapter-select.ts` resolves the declaration to a
concrete adapter instance.

## The four backends

| `id` | Backend | Schema handling | Notes |
|---|---|---|---|
| `claude` | Claude CLI | Native `--json-schema` | Tool events + token reporting. |
| `codex` | Codex CLI | Schema via temp file | Output read back from a file. |
| `copilot` | Copilot CLI | Prompt + validate/retry loop | Repairs output with `coercion.ts`. |
| `raw-api` | Anthropic SDK | Direct | Needs `ANTHROPIC_API_KEY`, no CLI required. |

Because schema support differs per backend, `coercion.ts` (`runWithSchemaRetry`) and `json.ts`
(`extractJson` + an AJV validator) normalize and repair model output with retries before it's handed
back to the runtime for the final zod validation.

## Combining harnesses in one run

`meta.harness` sets the **default** backend, but a single `agent()` call can override it with the
`adapter` option — so one workflow can fan work across several harnesses at once:

```ts
await agent("Draft the change.", { schema: PATCH })                  // → meta.harness default
await agent("Review it.", { adapter: "codex", schema: VERDICT })     // → this call runs on Codex
```

At run time the engine looks that id up in a memoised runner map — `buildRunnerMap` builds one runner
per detected harness, plus `raw-api` — and falls back to the run default if the requested adapter
isn't available, rather than failing. That's what lets you spend the strongest model only where it
pays off, have one harness adversarially check another's output, or keep running when a CLI is
missing — all in the same deterministic, journaled run.

## Capabilities

`detect.ts` probes `PATH` for available CLIs and declares each adapter's capability flags — native
schema support, token reporting, tool events. `defineworkflow adapters` prints what's detected on your
machine.

## Process spawning is injected

Every adapter spawns processes through a `ProcessRunner` abstraction — real in production, a
`FakeProcessRunner` in tests. Combined with `createScriptedRunner()` from `@workflow/core`, this is
what lets the whole engine be unit-tested without spawning a single real CLI.

## Writing a custom adapter

`generic.ts` builds a config-driven adapter for any CLI: give it the command, how to pass a schema,
and how to read the result, and it produces a conforming `AgentRunner`. For anything more bespoke,
implement the `AgentRunner` interface directly and return a `Result` — errors are values throughout.
