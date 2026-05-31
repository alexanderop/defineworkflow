# Harness event types from vendor SDKs — design

**Date:** 2026-05-31
**Status:** Approved design, ready for implementation planning

## 1. Problem

We orchestrate three coding-agent CLIs — `claude`, `codex`, `copilot` — each of which
emits a **different, undocumented, version-drifting** newline-delimited JSON (NDJSON)
event stream. Per-harness `StreamTranslator`s parse those streams into one canonical
`AgentProgress` contract (`{ tool?, tokens?, model? }`) plus a terminal `TranslatorResult`.

Today the translators parse **untyped JSON** with hand-written field checks
(`asRecord` + per-field `typeof`), and the unit-test **fixtures are hand-authored**.
This has two concrete failure modes:

1. **Silent drift.** When a CLI changes its event taxonomy across versions, nothing
   fails loudly — the translator just stops extracting a field and the UI quietly
   loses information.
2. **Fixtures that lie.** Because fixtures are hand-written, they can assert behavior
   the real CLI never had. This is not hypothetical — see the bug below.

### 1.1 The triggering bug

In the `tri-harness` example run, the `impl:codex` agent shows tokens and elapsed
time but **no model**, while `impl:claude` and `impl:copilot` show theirs.

Root cause, confirmed three independent ways:

- **Empirical capture:** `codex exec --json` (codex-cli 0.125.0) emits only
  `thread.started` (just `thread_id`) → `turn.started` (bare) → `item.completed` →
  `turn.completed`. No event carries the model.
- **Suppressed header:** codex prints `model: gpt-5.5` in its human-readable header,
  but that header is suppressed in `--json` mode (verified absent on both stdout and
  stderr).
- **Vendor type:** `@openai/codex-sdk`'s `ThreadStartedEvent` is
  `{ type: "thread.started"; thread_id: string }` — no `model`. The only `model` in
  the package is in `ThreadOptions`/`TurnOptions` (input config). The model is
  genuinely never emitted.

The codex translator (`codex-stream.ts`) reads `ev.model` off `thread.started` /
`turn.started`, and the fixture (`fixtures/codex-stream.ndjson:1`) was hand-authored
with a fabricated `"model":"gpt-5-codex"` that the real CLI never sends — so the unit
test passes while every real run gets `model = undefined`. The model reaches the UI
**only** via streaming `onProgress({ model })`; the final `AgentResult` has no model
field. With no stream model, codex stays blank.

## 2. Goals / non-goals

### Goals

- Fix the codex "no model" bug (display the model codex actually used).
- Replace untyped, hand-checked stream parsing with **types sourced from each CLI's
  first-party SDK**, validated at runtime via zod.
- Make harness-format drift **fail loudly and point at exactly what changed**, so
  migrating to a new CLI version is a bump-and-fix, not a silent regression.
- **Do not increase the published package size** — consumers of `defineworkflow`
  must not gain any vendor-SDK dependency.

### Non-goals

- Reworking the canonical `AgentProgress` contract or the events/reducer/UI path —
  that boundary (normalize at the adapter) stays exactly as documented in
  `docs/solutions/architecture-patterns/streaming-agent-progress-normalization-boundary.md`.
- Solving model-attribution on **journal replay / resume** (model isn't journaled).
  Out of scope; tracked separately.
- Switching from CLIs to provider HTTP APIs (the approach `pi` takes — see §3).

## 3. Prior art: how `pi` solves this

`earendil-works/pi` faces the same N-backends-N-taxonomies problem but talks to
provider **HTTP APIs** directly and leans on **vendor SDK types**
(`@anthropic-ai/sdk`, `openai`) as its compile-time source of truth — no codegen, no
captured fixtures, no zod for events. Its transferable patterns:

- One **hand-written canonical event union** + per-provider translator (consumers see
  one taxonomy). We already have this (`StreamTranslator` → `AgentProgress`).
- Each backend's divergence **quarantined in one named shim** (`mapCodexEvents`) with
  a single typed seam, not field checks scattered through the parser.
- Tests assert on **canonical output**, not raw wire shapes; a fully-typed fake
  backend (`faux.ts`) keeps unit tests off the network. We have
  `createFakeProcessRunner`.

**Why we differ:** `pi` can skip codegen _because every backend ships first-party TS
SDK types for its stream_. It turns out **ours do too** — as CLI-companion packages
rather than HTTP-API SDKs (§4). So `pi` validates the backbone; our addition is to
substitute the vendor types it gets for free with the CLI-companion types we now know
exist, and to add the runtime validation `pi` omits (justified because our types are
generated/vendored, not first-party imports we trust blindly).

Files referenced: `packages/ai/src/types.ts`,
`packages/ai/src/providers/openai-codex-responses.ts` (`mapCodexEvents`),
`packages/ai/src/utils/json-parse.ts`, `packages/ai/src/providers/faux.ts`.

## 4. Key finding: every CLI ships first-party event types

Verified by unpacking the published packages:

| CLI         | Type package                     | Ships                                                                                                                                                                                                                                     | Carries `model`?              | Size note                                        |
| ----------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------ |
| **codex**   | `@openai/codex-sdk`              | `ThreadEvent` union — comment: _"Top-level JSONL events emitted by codex exec"_; matches our capture 1:1                                                                                                                                  | **No** (only in input config) | 21 KB → devDep                                   |
| **claude**  | `@anthropic-ai/claude-agent-sdk` | `SDKMessage` union (`SDKSystemMessage` `subtype:'init'`, `SDKAssistantMessage`, `SDKResultMessage`, `SDKRateLimitEvent`, …); matches `--output-format stream-json`                                                                        | Yes (init)                    | 1.3 MB → devDep                                  |
| **copilot** | `@github/copilot`                | `copilot-sdk/generated/session-events.d.ts`, **auto-generated from `schemas/session-events.schema.json`** (a real first-party JSON Schema); `SessionEvent` union w/ `ModelChangeEvent`, `AssistantMessageEvent`, `AssistantUsageEvent`, … | Yes                           | **104 MB** → vendor the schema file only, no dep |

This makes "infer zod from captured samples" (an earlier candidate approach)
unnecessary — we don't infer types when the vendor publishes them.

## 5. Approach

**Vendor types are the source of truth. Generate committed zod from them at build
time. Validate at the raw→canonical boundary. Keep real fixtures as a conformance
corpus that proves the live CLI still matches the pinned types.**

### 5.1 No-bigger guarantee (hard constraint)

The published `defineworkflow` / `@workflow/adapters` runtime dependency set must not
gain any vendor SDK. Mechanism:

- `@openai/codex-sdk` and `@anthropic-ai/claude-agent-sdk` → **`devDependencies`**.
  npm does not ship `devDependencies` to consumers, so install size is unchanged.
- `@github/copilot` (104 MB) → **not even a devDependency.** We vendor only its
  first-party `schemas/session-events.schema.json` into the repo (committed), plus a
  refresh script that documents/automates re-extracting it.
- A **dev-time codegen step** emits **committed** `*-events.generated.ts` whose only
  import is `z`. Adapters import the generated zod; types come via `z.infer`.
- **Net runtime dependency added: zero vendor SDKs** (only zod, already present).

### 5.2 Per-harness sourcing

- **copilot** → vendored `session-events.schema.json` → `json-schema-to-zod` →
  generated zod (runtime-validating) + inferred types.
- **codex** → `@openai/codex-sdk` `.d.ts` → `ts-to-zod` → generated zod.
- **claude** → `@anthropic-ai/claude-agent-sdk` `.d.ts` → `ts-to-zod` → generated zod.

### 5.3 Bundle-size rule: generate only the events we parse

zod schemas are runtime values, not tree-shaken when referenced. claude's
`SDKMessage` union has 30+ variants; we consume ~4 (`system`/`init`, `assistant`,
`result`, `rate_limit_event`). copilot's `SessionEvent` union is ~80 variants; we
consume a handful (model change, assistant message, tool execution, usage, result).
Therefore codegen targets **only the event variants each translator actually reads** —
leaner output, reviewable diffs. The list of consumed events per harness is an
explicit, committed input to the codegen step (a small allow-list), not "whatever the
vendor ships."

### 5.4 Translator boundary

Each translator validates/narrows each parsed line against its generated zod union at
the raw→canonical seam (the analogue of `pi`'s `mapCodexEvents`), replacing
`asRecord` + ad-hoc `typeof` checks. A line that fails to match is the loud drift
signal. The canonical `AgentProgress` / `TranslatorResult` output is unchanged, so
nothing above the adapter changes.

### 5.5 Capture script + conformance corpus

- A dev/CLI **capture** command runs each installed harness on a fixed canonical task
  and writes the **real** NDJSON to `fixtures/<harness>-stream.ndjson`. These replace
  the hand-authored fixtures as the source of truth for _reality_.
- A **conformance test** drives every captured fixture line through the generated zod
  union and asserts it validates. This is the drift alarm: when a CLI bumps and
  changes shape, re-capturing makes the conformance test fail loudly → `pnpm update`
  the type package (codex/claude) or refresh the vendored schema (copilot) →
  regenerate zod → `tsc`/tests point at exactly what changed.
- Unit tests continue to assert on **canonical output** (per `pi` and our existing
  pattern), now driven by real fixtures.

### 5.6 Architectural boundary to resolve

CLAUDE.md states _"`@workflow/schema` is the only place that touches
`z.toJSONSchema()` / `safeParse`."_ Per-line event validation inside the adapters
would cross that boundary. The plan must choose one:

- **(a)** Place the generated event-zod + a thin `validateEvent` helper in
  `@workflow/schema`, and have adapters call it (keeps the rule intact).
- **(b)** Carve a sanctioned, documented exception for _internal harness-event
  parsing_ in adapters (distinct from _user output schemas_, which remain in
  `@workflow/schema`).

Leaning (a) — it keeps the single-zod-boundary invariant and the codegen output in
one package. To be finalized in the plan.

## 6. Phasing

### Phase 0 — ship the bug fix (small, independent)

1. **codex adapter** emits the model via a layered fallback, display-only (never
   changes which model codex runs):
   `req.model ?? configModel(cwd, profile) ?? undefined`, where `configModel` is a
   best-effort read of `model` from `~/.codex/config.toml` (`--profile`-aware). If
   none resolves, stay blank (we never guess codex's built-in default). Emitted via
   `ctx.onProgress({ model })`.
2. **De-lie the codex fixture:** remove the fabricated `"model":"gpt-5-codex"` from
   `fixtures/codex-stream.ndjson` so it matches the real CLI; update
   `codex-stream.test.ts` to assert the stream yields **no** model, and that the
   adapter-level fallback supplies it.
3. Keep the translator's `ev.model` read for forward-compat (if a future codex adds
   it, it takes precedence).

### Phase 1 — vendor-types-as-truth layer

1. Add codex/claude SDKs as devDeps; vendor copilot's `session-events.schema.json` +
   refresh script.
2. Codegen pipeline: allow-list of consumed events per harness → generated committed
   zod (`ts-to-zod` / `json-schema-to-zod`) → `pnpm codegen:harness-events` script.
3. Rewrite the three translators to validate/narrow against generated zod at the
   boundary.
4. `capture` command + real fixtures + conformance test.
5. Resolve the §5.6 boundary decision.

## 7. Testing strategy

- **Conformance** (new): every real fixture line validates against generated zod.
- **Translator unit tests** (existing, retargeted): assert canonical `AgentProgress`
  / `TranslatorResult` from real fixtures — model, tools, accumulated tokens, final
  text/data.
- **codex regression** (Phase 0): adapter supplies model from `req.model` and from a
  mocked config read; blank when neither resolves.
- **No new e2e cost in CI:** `capture` is a manual/dev command (spawns real agents,
  spends tokens); CI runs only against committed fixtures.
- Determinism rules unchanged (`fast-check` for generative coverage; no `faker`).

## 8. Risks & mitigations

- **SDK types vs. wire format mismatch.** The SDK type may describe a transport that
  differs from the exact CLI flag we invoke. _Mitigation:_ the conformance test runs
  real captured CLI output against the generated zod — if they ever disagree, it
  fails. (codex already verified 1:1; claude/copilot to be verified during capture.)
- **`ts-to-zod` output quality on large unions.** _Mitigation:_ the consumed-events
  allow-list (§5.3) keeps generated surface tiny and hand-reviewable.
- **copilot schema staleness.** The vendored schema can lag the installed CLI.
  _Mitigation:_ refresh script + conformance test against real copilot captures.
- **Generated-code review burden.** _Mitigation:_ small allow-list; generated files
  committed and diffed like `models.generated.ts` in `pi`.

## 9. Open questions (for the plan)

- §5.6 boundary: (a) vs (b).
- Is `capture` a `workflow` CLI subcommand or a standalone `pnpm` dev script?
- Exact consumed-events allow-list per harness.
- copilot schema refresh: scripted extraction from a temp `npm pack`, or manual?
