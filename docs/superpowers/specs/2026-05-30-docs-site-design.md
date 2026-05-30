# Documentation Site — Design

**Date:** 2026-05-30
**Status:** Approved design, ready for implementation planning

> **Naming note:** The library is referred to as `workflow` / `@workflow/*` throughout
> as a placeholder (the `@workflow` npm scope is likely taken — see the engine design
> spec). The docs are built so the product name, scope, repo, and domain live in a
> single `product.ts` data file and can be renamed in one edit.

## 1. Goal

A polished, **showcase-grade** documentation site for the `workflow` library — a
portable, harness-agnostic reimplementation of Claude Code's dynamic workflows. The
site's job is to *sell the concept* of deterministic multi-agent orchestration in the
first three seconds and then teach it thoroughly. It is a flagship/portfolio piece, so
look and feel are first-class requirements alongside correctness and completeness.

### Non-goals (v1)

- Versioned docs (single "latest" only).
- i18n / translations.
- Hosted full-text search (Algolia) — VitePress local search is enough to start.
- An interactive in-browser playground.

These are clean v2 additions and the architecture must not preclude them.

## 2. Decisions (resolved)

| Decision | Choice | Rationale |
|---|---|---|
| Framework | **VitePress** (latest) | Vue + Vite; powers Vue/Vite/Vitest/Pinia docs. Fully custom hero/home layout, Vue components in markdown, minimal to run — best fit for a showcase. |
| Primary audience | **Showcase / portfolio** (adopters second) | Drives the diagram-forward hero and the "How it works" depth section. |
| Hero direction | **Diagram-forward** | The hero *is* the `script → agents → result` fan-out graph, animated. Teaches the mental model before any reading. |
| API reference | **Hybrid** | Hand-written primitive pages (the surface readers touch) + TypeDoc-generated long tail (types, options, errors, adapter interfaces). |
| Hosting | **GitHub Pages** | Free, zero-config via a GitHub Action; standard for OSS. Custom domain is a one-line swap. |
| Naming | **Placeholder, centralized** | `product.ts` holds name/scope/repo/domain/colors; rename is a single edit. |

## 3. Placement & stack

The docs site is its own **private workspace package** at `apps/docs`:

- A new `apps/*` glob is added to `pnpm-workspace.yaml` to keep publishable libraries
  under `packages/` clean.
- `apps/docs/package.json` is marked `"private": true` and is **never published**.
- **VitePress** with a TypeScript config at `apps/docs/.vitepress/config.ts`.
- Scripts: `dev`, `build`, `preview`.
- **Turbo wiring:** a `docs#build` task depends on the libraries' `build` so API
  generation and code samples read the real compiled `dist` types. The default
  `turbo run build` does **not** include `docs#build` unless explicitly requested, so
  library CI stays fast.
- Local dev resolves `@workflow/*` to workspace source via the existing aliases.

```
workflow/
├─ packages/            (unchanged: core, schema, adapters, cli, ui)
└─ apps/
   └─ docs/             @workflow/docs (private)
      ├─ package.json
      ├─ .vitepress/
      │  ├─ config.ts          ← sidebar, nav, theme config; imports product.ts
      │  ├─ product.ts         ← name/scope/repo/domain/theme colors (single source)
      │  └─ theme/             ← extends default theme: brand gradient + hero
      │     ├─ index.ts
      │     └─ components/Hero.vue
      ├─ guide/                ← markdown content (see §4)
      ├─ patterns/
      ├─ adapters/
      ├─ cli/
      ├─ api/                  ← hand-written primitive pages
      │  └─ generated/         ← TypeDoc output (git-ignored)
      └─ how-it-works/
```

## 4. Information architecture

```
Home                        ← diagram-forward animated hero (Hero.vue)
Guide
  ├─ What is workflow?       ← the fan-out → reduce → synthesize mental model
  ├─ Installation
  ├─ Your first workflow     ← ~5-minute quickstart
  ├─ Core concepts
  │    ├─ The meta block
  │    ├─ Primitives (agent · parallel · pipeline · workflow · phase · log)
  │    ├─ Structured output (Zod schemas)
  │    ├─ Budget-aware loops
  │    ├─ Determinism & the sandbox
  │    ├─ Journaling & resume
  │    ├─ Worktree isolation
  │    └─ Concurrency & limits
  ├─ Patterns                ← adversarial verify, judge panel, loop-until-dry,
  │                             multi-modal sweep, pipeline vs parallel
  ├─ Adapters                ← choosing a harness (claude/codex/copilot/raw-api),
  │                             capability flags, writing a custom adapter
  ├─ CLI                     ← run, detach, resume, save-as-command
  └─ The progress UI         ← the Ink TUI, master-detail drill-down
API Reference                ← hybrid (see §6)
How it works                 ← architecture deep-dive (sandbox, scheduler, journal);
                                doubles as showcase "depth" material
```

The sidebar groups content under these top-level sections. The nav bar surfaces
Guide, Patterns, API Reference, How it works, plus a GitHub link (from `product.ts`).

## 5. The showcase layer

- **Hero component** (`theme/components/Hero.vue`): renders the animated
  `script → agents → result` graph in SVG + CSS (the diagram-forward direction). It
  sits above a clean wordmark and a real, runnable code snippet. The animation conveys
  fan-out (one node → many agents) → reduce → single result.
- **Branding centralized:** `.vitepress/product.ts` exports a single object —
  `{ name, scope, repo, domain, colors }` — imported by `config.ts` and the theme.
  Renaming the product (placeholder → real name) is one edit here.
- **Custom theme:** `theme/index.ts` extends the default VitePress theme, applying the
  brand accent gradient and registering the hero. Everything else inherits VitePress
  defaults for polish-by-default and low maintenance.

## 6. API reference (hybrid)

- **Hand-written primitive pages** under `api/` — one focused page per public
  primitive (`agent`, `parallel`, `pipeline`, `workflow`, `phase`, `log`, plus
  `budget` and `args`). Each carries the signature, rich examples, and links into the
  Patterns section. These are committed to git.
- **Auto-generated long tail** under `api/generated/` — **TypeDoc** with
  `typedoc-plugin-markdown` emits the exhaustive types, options, the `WorkflowError`
  union, and adapter interfaces from the real source. This runs as a pre-build step
  inside the `docs#build` Turbo task, so it always tracks the code.
- Generated pages are **git-ignored** (built on demand); only hand-written pages are
  committed. The sidebar groups "Primitives" (curated) above "Reference" (generated).

## 7. Build, deploy & quality

- **Deploy:** `.github/workflows/docs.yml` — on push to `main`, build VitePress with
  the correct `base` (derived from `product.ts`), upload the Pages artifact, and
  deploy to GitHub Pages. A custom domain is a one-line swap in `product.ts`.
- **Quality gates:**
  - The VitePress build **fails on dead internal links** (built-in) — this is the link
    check.
  - A lightweight CI **smoke check**: build, then drive `agent-browser` to load the
    homepage and assert the hero renders and primary nav works — catches a broken
    showcase before it ships.
  - The quickstart's code is sourced from a real, runnable example file where
    practical, so snippets stay honest.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `docs#build` slows or breaks library CI | `docs#build` is excluded from the default build; only the docs workflow/preview invoke it. |
| API generation drifts from hand-written pages | Generated pages are clearly separated under `api/generated/` and rebuilt every docs build from source. |
| Placeholder name leaks into many files | All naming flows from `product.ts`; content uses the product name via theme config, not hard-coded strings, wherever practical. |
| Hero animation regresses silently | `agent-browser` smoke check asserts the hero renders in CI. |

## 9. Open items deferred to the plan

- Exact VitePress version and the TypeDoc/markdown plugin versions (resolve via
  Context7 at implementation time).
- Final theme palette values in `product.ts` (placeholder accent gradient for now).
- Whether the runnable quickstart example lives in `apps/docs/examples/` or reuses a
  bundled CLI example.
