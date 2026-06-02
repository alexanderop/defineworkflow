# PRD: Convert Workflow Engine to Rust

## Status

Example AFK pipeline spec. This is intentionally written as a large, 5+ point migration candidate so it can be sliced into vertical AFK tickets.

## Summary

Port the deterministic multi-agent workflow engine from TypeScript/Node to Rust while preserving the existing authoring experience and observable behavior.

The first milestone is **not** a full rewrite of every package. It is a Rust core runtime and CLI prototype that can execute a minimal workflow, journal agent/question results deterministically, replay from the journal, and emit the same event vocabulary expected by the UI/registry layer.

## Goals

- Preserve deterministic workflow execution semantics.
- Preserve crash-safe replay via sequence-numbered journal records.
- Preserve the public workflow concepts: `agent`, `parallel`, `pipeline`, `phase`, `log`, `workflow`, `askUserQuestion`, and `budget`.
- Provide a Rust CLI prototype that can run a simple bundled workflow fixture.
- Keep the TypeScript implementation working during the migration.
- Produce enough compatibility tests to compare Rust behavior against the TypeScript engine.

## Non-goals

- Full replacement of the Ink UI in this milestone.
- Full TypeScript sandbox compatibility in Rust in this milestone.
- Publishing a Rust crate to crates.io.
- Replacing all harness adapters at once.
- Supporting arbitrary npm imports in Rust-authored workflows.

## Users

- Maintainers who want a faster, safer engine core.
- Workflow authors who should not lose determinism or replay guarantees.
- Future adapter/UI developers who need stable JSON event and journal formats.

## Current system context

This repo is a pnpm monorepo. The core engine currently lives primarily in `packages/core`, with adapters in `packages/adapters`, CLI orchestration in `packages/cli`, and authoring types in `packages/workflow`.

Important invariants to preserve:

- Every agent/question operation consumes a monotonically increasing sequence number.
- Replay checks the journal by sequence number before invoking a model or asking a human.
- Sandbox execution must reject nondeterminism like `Date.now()`, `Math.random()`, and argless `new Date()`.
- Budget checks are soft gates.
- Nested workflows are one level deep.
- Events are the observable contract.
- Errors are values in the current TypeScript implementation; Rust should model errors explicitly with enums and `Result`.

## Proposed Rust layout

Add a Rust workspace under `rust/`:

```txt
rust/
├── Cargo.toml
├── crates/
│   ├── workflow-core/        # runtime state machine, events, journal, budget
│   ├── workflow-cli/         # prototype CLI binary
│   ├── workflow-adapters/    # mock adapter first, then CLI adapters
│   └── workflow-fixtures/    # compatibility fixtures and golden files
└── README.md
```

The Rust core should use serde-compatible JSON shapes for events, journal records, errors, requests, and agent results.

## Functional requirements

### 1. Rust workspace scaffold

- Add a `rust/Cargo.toml` workspace.
- Add `workflow-core` crate with exported modules for events, journal, runtime, errors, and test helpers.
- Add `workflow-cli` crate with a `workflow-rs` binary.
- Add `workflow-adapters` crate with a deterministic mock runner.
- Add CI-friendly commands documented in `rust/README.md`.

Acceptance criteria:

- `cargo test --workspace` passes.
- `cargo fmt --check` passes.
- `cargo clippy --workspace --all-targets -- -D warnings` passes or is documented as follow-up if the repo lacks clippy setup.
- TypeScript package scripts are not broken.

### 2. Event and journal compatibility model

Define Rust structs/enums for the core event and journal vocabulary.

Acceptance criteria:

- Events serialize to tagged JSON compatible with the TypeScript event style.
- Journal records serialize as JSONL-compatible values.
- Golden tests cover at least:
  - `run-started`
  - `phase-started`
  - `agent-queued`
  - `agent-started`
  - `agent-completed`
  - `question-asked`
  - `question-answered`
  - `run-completed`
  - one error event
- Existing TypeScript event names are not renamed.

### 3. Deterministic runtime sequence

Implement a Rust runtime state machine for agent calls and human questions.

Acceptance criteria:

- `agent()` increments the shared sequence counter.
- `ask_user_question()` shares the same sequence counter.
- Journal hit by sequence number returns cached output and does not call the runner/question handler.
- Journal miss invokes the mock runner/question handler, records the result, and emits events.
- Unit tests cover replay for both agent and question calls.

### 4. Mock runner and schema-light output

Add a deterministic mock runner for Rust tests and the prototype CLI.

Acceptance criteria:

- Mock runner returns deterministic outputs from fixed fixtures.
- No randomness or wall-clock dependency is used in tests.
- Agent result includes usage fields with fixed defaults.
- A simple object output can be round-tripped through JSON.

### 5. Prototype CLI execution

Add `workflow-rs run <fixture>` for a small fixed fixture format. The fixture does not need to execute TypeScript. It can be a JSON or TOML workflow plan for the prototype.

Example fixture:

```json
{
  "name": "hello-rust-runtime",
  "steps": [
    { "type": "phase", "name": "draft" },
    { "type": "agent", "prompt": "write a haiku", "key": "haiku" },
    { "type": "question", "key": "topic", "prompt": "Topic?", "default": "rust" }
  ]
}
```

Acceptance criteria:

- `workflow-rs run rust/crates/workflow-fixtures/hello.json` emits JSONL events to stdout.
- Running the same fixture with an existing journal replays without invoking the mock runner/question handler.
- CLI exits non-zero on corrupt fixture or corrupt journal.

### 6. Compatibility test bridge

Add a small compatibility test strategy comparing Rust JSON output to TypeScript golden fixtures.

Acceptance criteria:

- Golden files live in a predictable location, e.g. `rust/crates/workflow-fixtures/golden/`.
- At least one Rust test asserts exact event JSON for a simple run.
- The spec documents how to add future golden fixtures from TypeScript.

## UX requirements

- The Rust prototype should be obviously experimental.
- CLI help should say this is a compatibility prototype, not the production `workflow` binary.
- Error messages should include the failing file path when fixture/journal parsing fails.

## Migration strategy

1. Build Rust core beside the TypeScript implementation.
2. Prove event/journal compatibility on fixed fixtures.
3. Add adapter parity gradually.
4. Add sandbox/story compatibility later.
5. Only then consider replacing TypeScript runtime entrypoints.

## Risks

- TypeScript VM sandbox behavior may be hard to reproduce in Rust.
- Zod-to-JSON-Schema behavior may not map cleanly.
- UI expectations may depend on subtle event ordering.
- A rewrite can stall if it tries to port every package before proving the core loop.

## Suggested vertical slices

These are examples; the AFK pipeline should refine them into `docs/tickets/` files.

### Slice 1: Rust workspace and core event model

End-to-end value: a maintainer can run `cargo test` and see Rust events serialize to expected JSON.

Scope:

- `rust/Cargo.toml`
- `workflow-core` crate
- event structs/enums
- golden serialization tests

### Slice 2: Journal model and replay lookup

End-to-end value: a sequence-numbered journal can be written, read, and queried.

Scope:

- journal record type
- JSONL read/write helpers
- corrupt journal error
- replay lookup tests

### Slice 3: Runtime agent/question sequencing

End-to-end value: the Rust runtime can execute mock agent and question operations with deterministic sequence numbers.

Scope:

- runtime state machine
- mock runner
- question handler
- replay tests
- emitted event assertions

### Slice 4: Prototype CLI fixture runner

End-to-end value: `workflow-rs run <fixture>` emits JSONL events for a tiny workflow plan.

Scope:

- `workflow-cli` crate
- fixture parser
- stdout JSONL events
- journal path option
- CLI error handling

### Slice 5: Compatibility golden fixture bridge

End-to-end value: contributors can compare Rust event output against golden fixtures and know when compatibility regresses.

Scope:

- fixture documentation
- golden event file
- exact JSON test
- instructions for generating/updating fixtures

### Slice 6: Migration report

End-to-end value: maintainers know what Rust supports, what remains TypeScript-only, and what to do next.

Scope:

- `rust/README.md`
- migration status table
- known gaps
- next-slice recommendations

## Definition of done for this milestone

- Rust workspace exists and passes Rust tests.
- A prototype CLI can run a simple fixture and replay from a journal.
- Event and journal JSON shapes are covered by golden tests.
- The TypeScript monorepo still builds/tests as before.
- A migration report documents remaining gaps and next steps.

## AFK pipeline kickoff prompt

Use this with the AFK extension:

```txt
/afk start docs/prd-convert-workflow-to-rust.md
```

Then ask Pi:

```txt
Use the afk-coding skill. Read docs/prd-convert-workflow-to-rust.md, validate the spec, then slice it into vertical tickets under docs/tickets/. Keep the AFK board updated.
```
