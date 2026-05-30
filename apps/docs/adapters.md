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

The harness is **declared in `meta.harness`** and is the single source of truth — there is no
auto-detect and no CLI/config override. `adapter-select.ts` resolves that declaration to a concrete
adapter instance.

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

## Capabilities

`detect.ts` probes `PATH` for available CLIs and declares each adapter's capability flags — native
schema support, token reporting, tool events. `workflow adapters` prints what's detected on your
machine.

## Process spawning is injected

Every adapter spawns processes through a `ProcessRunner` abstraction — real in production, a
`FakeProcessRunner` in tests. Combined with `createScriptedRunner()` from `@workflow/core`, this is
what lets the whole engine be unit-tested without spawning a single real CLI.

## Writing a custom adapter

`generic.ts` builds a config-driven adapter for any CLI: give it the command, how to pass a schema,
and how to read the result, and it produces a conforming `AgentRunner`. For anything more bespoke,
implement the `AgentRunner` interface directly and return a `Result` — errors are values throughout.
