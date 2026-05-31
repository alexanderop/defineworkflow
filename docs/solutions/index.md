# Documented Solutions

Knowledge store of past problems and learnings. Read the relevant file before working in its area.

## Architecture Patterns
- [Multi-file workflows: esbuild-bundle local imports into one self-contained source before the vm sandbox](architecture-patterns/multi-file-workflows-esbuild-bundle.md)
- [Harness-neutral live agent progress: normalize at the adapter via StreamTranslator → onProgress](architecture-patterns/streaming-agent-progress-normalization-boundary.md)
- [Bundled workflow scripts run in a vm sandbox: determinism guard, injected z/URL, zod-only schemas](architecture-patterns/workflow-sandbox-script-constraints.md)

## Conventions
- [Enforcing immutability structurally with type-fest (Immutable/Tagged/JsonValue), not the linter](conventions/type-fest-structural-immutability-vocabulary.md)

## Developer Experience
- [Running knip in this monorepo: the four built-in false positives and how they're suppressed](developer-experience/knip-false-positives-in-this-monorepo.md)
- [Typed pipeline() overloads, zod-only schemas, and shipping URL types to a types:[] package](developer-experience/typed-pipeline-overloads-zod-only-url-types.md)
- [vitest 4 upgrade crashes pnpm test with vite/module-runner ERR_PACKAGE_PATH_NOT_EXPORTED](developer-experience/vitest-4-vite-module-runner-exports-error.md)
- [Build before pnpm test, and don't use pnpm --filter to run vitest in this monorepo](developer-experience/vitest-monorepo-build-and-filter-quirks.md)

## Integration Issues
- [Claude --json-schema silently ignores any schema carrying a $schema key](integration-issues/claude-json-schema-ignores-dollar-schema-key.md)
- [Claude schema output can be prose before structured_output](integration-issues/claude-schema-output-retry.md)
- [transformScript detect/replace desync: a defineWorkflow export named in a comment breaks the rewrite](integration-issues/transformscript-comment-export-desync.md)

