---
title: "Claude --json-schema silently ignores any schema carrying a $schema key"
date: 2026-05-31
track: bug
category: integration-issues
problem_type: "cli_adapter_schema_failure"
module: "schema"
component: "zod-to-json-schema"
tags: ["claude", "schema", "structured-output", "zod", "json-schema", "adapter", "workflow"]
symptoms: "Real Claude agent returns prose / invented fields instead of structured output; run fails with SchemaValidation (required props missing, additional property present)"
root_cause: "zod v4 z.toJSONSchema() stamps a $schema meta key on its output; Claude Code's --json-schema flag silently ignores any schema that carries it and falls back to free prose"
resolution_type: "code-fix"
related:
  - "integration-issues/claude-schema-output-retry.md"
  - "architecture-patterns/workflow-sandbox-script-constraints.md"
  - "developer-experience/typed-pipeline-overloads-zod-only-url-types.md"
---

# Claude --json-schema silently ignores any schema carrying a $schema key

## Problem

A real (non-`--mock`) Claude agent with a zod `schema` would not honor the schema at all. The model
free-associated prose or invented fields, and the run failed at the adapter's AJV boundary after the
schema-retry attempts were exhausted:

```text
run failed: SchemaValidation after 2 attempt(s): (root) must have required property 'title';
  (root) must have required property 'impact'; (root) must have required property 'tags';
  (root) must NOT have additional properties "headline"
  model output: { "headline": "Deterministic Workflows: Replay Your Agent Runs…" }
```

The schema required `title` / `impact` / `tags`; the model returned an unrelated `headline` field —
proof the schema never reached the model as a constraint.

## Symptoms

- Only reproduces with a **real** harness run; `--mock` (the fabricating runner) passes, masking it.
- The Claude CLI `result` event contains prose and has **no `structured_output` key at all**.
- `pnpm run zod` (the `zod-mock.workflow.ts` verification fixture, run for real) failed.

## What Didn't Work

- **Adding `--mock` to the npm script.** That makes the fixture pass by fabricating schema-valid data,
  but hides the real defect — the live schema path was broken. (Treating the symptom, not the cause.)
- Assuming the zod → JSON Schema conversion was malformed. The emitted schema is valid and AJV-correct.

## Root Cause

Isolated with a single-variable experiment against the real `claude` CLI (2.1.158):

| Schema fed to `claude --json-schema`                             | Result                        |
| ---------------------------------------------------------------- | ----------------------------- |
| Our full schema **without** the `$schema` key                    | `structured_output` present ✓ |
| A trivial schema **with** `"$schema":".../draft/2020-12/schema"` | prose, no structured output ✗ |

zod v4's `z.toJSONSchema()` stamps a top-level `"$schema": "https://json-schema.org/draft/2020-12/schema"`
on every conversion, and `@workflow/schema`'s `toJsonSchema()` passed it through verbatim. Claude Code's
`--json-schema` parser **silently ignores any schema that carries that meta key** and falls back to
free prose. The schema retry loop then can't recover because every attempt is unconstrained.

This is distinct from [claude-schema-output-retry](./claude-schema-output-retry.md): there the issue is
_timing_ (prose arrives before `structured_output`); here the schema is rejected outright, so
`structured_output` is **never** produced.

## Solution

Strip the `$schema` meta key at the single conversion boundary (`packages/schema/src/zod.ts`). No
internal consumer needs it — `compileValidator` is pinned to the `Ajv2020` build and validates against
draft 2020-12 regardless of the key.

```diff
- const out: JsonSchema = z.toJSONSchema(input);
- return out;
+ const { $schema: _discarded, ...out }: JsonSchema = z.toJSONSchema(input);
+ return out;
```

Note the explicit `: JsonSchema` (= `Record<string, unknown>`) annotation on the destructure: typing
`input` via `Parameters<typeof z.toJSONSchema>[0]` selects zod's _registry_ overload, whose return type
lacks `$schema`, so destructuring it directly fails the DTS build. Annotating the binding restores the
plain-object view.

## Why This Works

The `$schema` URI is a JSON-Schema _annotation_, not a constraint — every internal consumer ignores it
(AJV is configured for 2020-12 explicitly). Removing it makes Claude's native structured output engage,
so the model is actually constrained and returns `{ title, impact, tags }` that validates first try.

## Cross-harness behavior (verified live)

- **claude** — broken by `$schema`; the only harness that needs the fix.
- **codex** (`--output-schema <file>`) — tolerant; honors the schema with or without `$schema`.
- **copilot** (schema injected into the prompt text + AJV validation) — `$schema` is harmless text.

So the fix is required for Claude and harmless/beneficial everywhere else.

## Prevention

- When handing a converted JSON Schema to a CLI's native structured-output flag, probe the real CLI:
  confirm the terminal event actually carries `structured_output`, not just that the process exits 0.
- Don't let `--mock` be the only thing exercising a schema path — `--mock` fabricates schema-valid data
  and will never reveal that the live harness ignores the schema.
- Treat `z.toJSONSchema()` output as needing normalization at the `@workflow/schema` boundary; harness
  parsers vary in strictness about meta keys (`$schema`, and potentially `$id`/`$defs`).
