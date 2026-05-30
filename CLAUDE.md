# workflow-monorepo

A pnpm + Turbo monorepo (ESM, Node ≥20) for a workflow engine. Packages live under `packages/`:
`core`, `schema`, `adapters`, `cli`, `ui`.

## Commands

- `pnpm build` — build all packages (turbo)
- `pnpm typecheck` — type-check all packages
- `pnpm lint` — oxlint
- `pnpm test` — vitest run; `pnpm test:e2e` — e2e project (`WORKFLOW_E2E=1`)

## Reference

`docs/solutions/` — documented solutions to past problems (bugs + knowledge), by category, with YAML frontmatter (module, tags, problem_type) — relevant when implementing or debugging in documented areas.
