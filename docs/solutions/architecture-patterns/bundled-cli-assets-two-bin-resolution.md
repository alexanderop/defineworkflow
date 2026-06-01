---
title: "Bundling runtime asset files (init templates) for a CLI that ships under two bins: author in the cli package, copy into the publishable package"
date: 2026-06-01
track: knowledge
category: architecture-patterns
problem_type: "packaging_asset_resolution"
module: "cli"
component: "templates"
tags:
  - "workflow-init"
  - "templates"
  - "packaging"
  - "npm-pack"
  - "Env.templatesDir"
  - "node-deps"
  - "two-bin"
  - "prebuild"
  - "tsup"
applies_when: "shipping non-code asset files (templates, fixtures, schemas) with the CLI, or adding any Env path that resolves relative to the running cli.js"
---

# Bundling runtime asset files for a CLI that ships under two bins

## Context

`workflow init <template>` reads bundled template files + a `templates/index.json` manifest at
runtime, located via a new `Env.templatesDir`. The trap: this engine ships the **same CLI under two
binaries**, and a path resolved relative to `cli.js` lands in a different package for each:

- `@workflow/cli` bin `workflow` → `packages/cli/dist/cli.js`
- published `defineworkflow` bin → `packages/workflow/dist/cli.js` (tsup `noExternal: [/^@workflow\//]`
  bundles the whole CLI into the workflow package's own `dist/cli.js`)

`node-deps.ts` sets `templatesDir: path.resolve(path.dirname(cliPath), "..", "templates")`. That is
`packages/cli/templates` for the first bin and `packages/workflow/templates` for the second. If the
template source lives in only one package, the **other bin hard-fails** ("templates index not found")
— and unit tests don't catch it because they inject a fake `templatesDir`. Only running the _actual_
built `cli.js` for each bin surfaces it.

## Guidance

- **Author the assets in the package whose `node-deps.ts` resolves them** (`packages/cli/templates/`),
  co-located with the loader + commands that read them. Then the dev `workflow` bin resolves
  `<cli>/dist/../templates` → `packages/cli/templates` with zero extra steps.
- **Copy them into the publishable package at build time.** `defineworkflow`'s `prebuild`
  (`packages/workflow/scripts/copy-templates.mjs`, wired as `"prebuild": "node …"`; pnpm runs
  pre/post script hooks automatically) copies `packages/cli/templates/` → `packages/workflow/templates/`
  and adds `"templates"` to that package's `files` so the tarball ships them. The copy is **git-ignored**
  (`packages/workflow/templates/`), regenerated every build — committing it would drift.
- **Keep the copy step self-contained** — depend only on a package already in `dependencies`
  (here `esbuild`), never on a sibling's built `dist/`, so it is safe early in a topological build / CI.
  Use it to _validate_ while copying: assert each manifest entry's file exists, its `harness` string
  literal matches the manifest (the invariant `list-templates` relies on, since it never reads the
  workflow files), and that each template bundles under the CLI's "local files + `defineworkflow` only"
  rule. A mismatch throws → the build fails.
- **`tsup` has no asset-copy hook** and the `private` examples package would not survive `npm pack`, so
  a `prebuild` Node script is the copy mechanism. A symlink would not survive packing either.
- **Keep the asset dir out of `tsconfig` `include` and add it to knip `ignore`.** The cli/workflow
  tsconfigs `include: ["src"]`, so a package-root `templates/` is not typechecked — important because
  the template files self-import `"defineworkflow"` (only resolvable on a _user's_ disk). knip would
  otherwise flag every template `.ts` as an unused file: add `packages/cli/templates/**` to
  `ignore`. The git-ignored generated copy needs no knip entry (knip honors `.gitignore`).

## Verification that actually catches the bug

- Run **each** built bin, not just one: `node packages/cli/dist/cli.js list-templates` **and**
  `node packages/workflow/dist/cli.js list-templates`. Unit tests with an injected `templatesDir`
  pass regardless, so they can't.
- `cd packages/workflow && npm pack --dry-run | grep templates/` lists `index.json` + every entry.
- Scaffold + `--mock` run each template end-to-end ("it scaffolded" should imply "it runs").

## When to Apply

- Adding any bundled non-code asset (templates, fixtures, JSON schemas) read at runtime by the CLI.
- Adding any `Env.*Dir` resolved relative to `cliPath` — check what it resolves to under **both** bins.
- Debugging "<asset> not found" that only reproduces from a published install / one of the two bins.
