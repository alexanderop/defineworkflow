# Agent profiles — design

## Problem

Workflow authors repeat the same execution config (`adapter`, `model`, `isolation`) across
many `agent()` calls, and there is no way to attach a reusable "role" / persona to a class of
agent calls. We want a named, reusable bundle of agent defaults — a **profile** — without
losing the explicitness of the existing `agent()` call site.

## Goals

- **Reuse / DRY** — define `adapter`/`model`/`isolation`/`instructions` once, apply to many calls.
- **Roles + instructions** — a profile can carry an `instructions` string (a persona/system hint).
- **Stay explicit** — the call site still reads as a normal `agent()` call; nothing is hidden.

## Non-goals (v1)

- **Cross-workflow sharing.** The sandbox runs scripts through `new vm.Script` with no module
  loader; only `import … from "workflow"` is stripped. A real cross-file `import { reviewer }
from "./profiles.js"` would survive into the VM and throw. Profiles are therefore **within-file**
  in v1. `export` is allowed so files are forward-compatible, but actual sharing waits for a
  future bundling effort.
- **Composition API.** No `extend()`. Compose with plain object spread of a config object.
- **Native per-adapter system prompts.** `instructions` is applied as a prompt prefix in v1
  (adapter-neutral, zero adapter changes). Wiring `instructions` to a backend's real `system`
  param (notably `raw-api`) is a noted follow-up.

## Authoring API

```ts
const base = { adapter: "claude", model: "sonnet", isolation: "worktree" } as const;
export const reviewer = profile({ ...base, instructions: "Review for correctness risks only." });

phase("Review");
const findings = await agent(reviewer, prompt, { schema: FINDINGS, label: "review-api" });
```

- `profile(config)` is a **pure** factory: it freezes the config and returns an opaque,
  **branded** `Profile`. No runtime state, no nondeterminism.
- `ProfileConfig` is a curated subset of `AgentOptions`:
  `{ adapter?, model?, agentType?, isolation?, instructions? }`. Per-call fields
  (`label`, `phase`, `schema`) are **not** in the type, so tsc rejects them inside a profile.
- `agent()` gains a profile-first overload: `agent(profile, prompt, opts?)` alongside the
  existing `agent(prompt, opts?)`. Schema-driven return inference is identical in both.
- Composition is plain spread of a config object: `profile({ ...base, instructions: "…" })`.

## Merge & override semantics

When the first arg to `agent()` is a `Profile`:

- `resolved = { ...profileConfig, ...callOpts }` — **call-site wins**.
- `overrides` = keys present in both `profileConfig` and `callOpts` whose values differ.
- This resolution happens at the **very top** of `agent()`, producing the exact same
  `AgentOptions` shape the runtime already consumes. `seq` → journal lookup → budget → cap →
  semaphore → schema → `runner.run` are all unchanged. Determinism and resume are untouched.

## `instructions` field (the one new capability)

- Added to `AgentOptions` and `ProfileConfig`.
- v1 resolution: the runtime prepends `instructions` to the request prompt
  (`${instructions}\n\n${prompt}`) when building the `AgentRequest`. No adapter changes.
- The prefix is applied to `request.prompt` only — **after** label/key derivation — so it does
  not change an agent's label or journal key.

## Observability

- The `agent-queued` event gains an optional `overrides?: readonly string[]` (e.g. `["model"]`).
  No console noise. The UI may render an "overridden" marker off the event.
- Profiles are anonymous config — no profile _name_ in events in v1 (the `const` name is not
  available at runtime).

## Runtime / sandbox wiring

- `profile`, `isProfile`, `Profile`, `ProfileConfig` live in `@workflow/core`.
- `loader.ts` injects `profile` into the sandbox globals so `profile(…)` resolves at
  module-eval time (it runs at top level, before `run()`, so it must be a free global — same
  mechanism as `agent`).
- `stripWorkflowImports` already removes `import { profile } from "workflow"`; no `sandbox.ts`
  change beyond the new global.
- The `workflow` package re-exports the `Profile`/`ProfileConfig` types (type-only, no bundle
  bloat) and exposes a `profile` authoring stub + the new `agent` overloads for editor support.

## Testing

- **core/runtime**: merge precedence (call wins), override-detection event, pass-through of
  `adapter`/`model`/`isolation`, `instructions` reaches `request.prompt` as a prefix, schema
  inference still works with a profile, resume/journal unchanged with a profile.
- **core/profile**: `profile()` freezes config, `isProfile()` discriminates, plain `agent()`
  call unaffected.
- **core/sandbox**: `profile` global available; `import { profile } from "workflow"` stripped.
- **workflow**: type-level — profile rejects `label`/`schema`; `agent(profile, …)` infers the
  schema output type.
- **examples**: add a profile to the feature-pipeline example.
