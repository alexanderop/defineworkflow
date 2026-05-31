# Documented Solutions

Knowledge store of past problems and learnings. Read the relevant file before working in its area.

## Architecture Patterns
- [Harness-neutral live agent progress: normalize at the adapter via StreamTranslator → onProgress](architecture-patterns/streaming-agent-progress-normalization-boundary.md)
- [Bundled workflow scripts run in a vm sandbox with no imports, no zod, no Date.now/Math.random](architecture-patterns/workflow-sandbox-script-constraints.md)

## Conventions
- [Enforcing immutability structurally with type-fest (Immutable/Tagged/JsonValue), not the linter](conventions/type-fest-structural-immutability-vocabulary.md)

## Developer Experience
- [Build before pnpm test, and don't use pnpm --filter to run vitest in this monorepo](developer-experience/vitest-monorepo-build-and-filter-quirks.md)
- [Running knip in this monorepo: the four built-in false positives and how they're suppressed](developer-experience/knip-false-positives-in-this-monorepo.md)

## Integration Issues
- [Claude schema output can be prose before structured_output](integration-issues/claude-schema-output-retry.md)
- [codex exec --json never emits its model — supply a display-only fallback at the adapter](integration-issues/codex-never-emits-model-display-fallback.md)
