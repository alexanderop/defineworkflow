---
title: "Claude schema output can be prose before structured_output"
date: 2026-05-30
track: bug
category: integration-issues
problem_type: "cli_adapter_schema_failure"
module: "adapters"
component: "claude"
tags: ["claude", "schema", "structured-output", "adapter", "retry", "workflow"]
symptoms: "Schema-bearing Claude agents fail with AdapterSpawn: result was not valid JSON for the requested schema"
root_cause: "Claude Code can exit 0 with is_error false while result contains prose or fenced JSON and structured_output is absent until a later structured-output turn"
resolution_type: "code-fix"
related:
  - "architecture-patterns/streaming-agent-progress-normalization-boundary.md"
---

# Claude schema output can be prose before structured_output

## Problem

Schema-bearing Claude Code agents in workflows could fail even though the CLI process exited
successfully. The adapter classified non-JSON final text as an `AdapterSpawn` failure instead of a
schema-compliance miss that can be retried.

## Symptoms

The Vue newsletter workflow showed a failing source agent:

```text
AdapterSpawn (claude): result was not valid JSON for the requested schema
```

A live Claude Code probe showed the relevant shape: Claude first emitted fenced JSON as assistant
text, then a stop hook asked it to call `StructuredOutput`, and only the terminal `result` event
carried `structured_output`.

## What Didn't Work

Treating `--json-schema` as a guarantee that the first terminal `result` is JSON is too strict.
Claude Code may produce successful prose or fenced JSON while `structured_output` is still absent.
Mapping that directly to `AdapterSpawn` prevents the existing schema retry loop from correcting
the response.

## Solution

Route Claude schema responses through the same validation/retry helper used by other adapters.
Use native `structured_output` when present, fall back to extracting JSON from result text, and
let missing or invalid schema data become `SchemaValidation` after retries.

```diff
- JSON.parse(final.text)
- return AdapterSpawn on parse failure
+ final.data ?? extractJson(final.text)
+ validate with runWithSchemaRetry
+ return SchemaValidation after exhausted retries
```

Add a regression test where the first Claude result is successful prose and the second result is
schema-valid JSON.

## Why This Works

Process failures and model-output failures are different failure modes. Non-zero exit and
`is_error:true` still surface as `AdapterSpawn`. A successful Claude run that simply failed to
produce schema data is now handled as validation feedback, so Claude gets a second attempt with a
specific correction hint.

## Prevention

When adapting CLI structured-output features, test both the native structured-output path and the
plain-text/fenced-JSON path. Do not assume a CLI flag upgrades every successful response into
schema data; keep schema validation at the adapter boundary and reserve spawn errors for actual
process or harness errors.
