---
title: "vitest 4 upgrade crashes pnpm test with vite/module-runner ERR_PACKAGE_PATH_NOT_EXPORTED"
date: 2026-05-31
track: bug
category: developer-experience
problem_type: "dependency_resolution_failure"
module: "monorepo-root"
component: "vitest"
tags:
  [
    "vitest",
    "vite",
    "vitepress",
    "pnpm",
    "lockfile",
    "module-runner",
    "exports",
    "dependabot",
    "peer-dependency",
    "monorepo",
    "test-harness",
    "migration",
  ]
applies_when: "upgrading vitest to 4.x in a pnpm + Turbo monorepo that also has vitepress (or another consumer pinning vite 5)"
---

# vitest 4 upgrade crashes pnpm test with vite/module-runner ERR_PACKAGE_PATH_NOT_EXPORTED

## Problem

A dependabot bump of `vitest` 2.1.9 → 4.1.7 made `pnpm test` (`vitest run`) crash at startup —
before a single test ran. The cause was not vitest: pnpm had resolved vitest 4's `vite` dependency
to **vite 5.4.21**, the version `vitepress` pins, which is out of vitest 4's `^6 || ^7 || ^8` range.

## Symptoms

```
⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './module-runner' is not defined by
"exports" in .../node_modules/.pnpm/vite@5.4.21.../node_modules/vite/package.json imported from
.../node_modules/.pnpm/vitest@4.1.7.../node_modules/vitest/dist/chunks/nativeModuleRunner.*.js
```

`vitest/dist/.../nativeModuleRunner.*.js` imports `vite/module-runner`, a subpath that **only exists
in vite ≥ 6**. With vite 5.4.21 wired in, the subpath isn't exported → hard crash.

Diagnostic confirmation:

- `pnpm why vite` showed a **single** `vite@5.4.21` shared by **both** `vitepress` and `vitest` — the
  smoking gun.
- vitest's installed `package.json` declares `vite: "^6.0.0 || ^7.0.0 || ^8.0.0"` in **both**
  `dependencies` and `peerDependencies`.
- The `.pnpm` dir name (`vitest@4.1.7_..._vite@5.4.21_...`) and the lockfile snapshot block
  (`vitest@4.1.7(...)(vite@5.4.21...)` with `vite: 5.4.21` nested under its `dependencies`) confirmed
  the bad pin.

## What Didn't Work

- **`pnpm install`** — reported `Already up to date`; the botched dependabot lockfile (which still
  carried stale `vitest@2.1.9` and `@vitest/coverage-v8@2.1.9` entries) superficially satisfied
  `package.json`, so nothing re-resolved.
- **`rm pnpm-lock.yaml && pnpm install`** — regenerated the lockfile (and usefully dropped the stale
  vitest@2 / coverage-v8@2.1.9 cruft) but **still** pinned vitest → vite@5.4.21. Because vite 5 was
  the _only_ vite in the tree (vitepress's), pnpm satisfied vitest's vite from it rather than fetching
  a fresh in-range copy. Regenerating alone is not enough — you must _introduce_ a valid version.

## Solution

Add an explicit, in-range vite at the workspace root so pnpm has a compatible version to resolve
vitest against. The two vite majors then coexist intentionally — vitepress keeps vite 5, vitest gets
vite 7 — then regenerate the lockfile.

```diff
  // package.json (root) — devDependencies
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
+   "vite": "^7.0.0",
    "vitest": "^4.1.7"
```

```bash
rm pnpm-lock.yaml && pnpm install   # vite resolves to 7.3.3; vitest 4.1.7 accepts ^6||^7||^8
```

Secondary fix surfaced by `pnpm knip` (exit 0 but errored on load): a dead `vitest.workspace.ts`
remained from the migration. **Vitest 4 dropped external workspace files** — `defineWorkspace` is no
longer exported from `vitest/config`; config now lives in `vitest.config.ts` as a `projects: [...]`
array. Vitest 4 silently ignored the stale file (tests passed) but knip choked on it:

```
Error loading vitest.workspace.ts ((0 , _config.defineWorkspace) is not a function)
```

```diff
- // DELETE vitest.workspace.ts — vitest 4 removed defineWorkspace
- import { defineWorkspace } from "vitest/config";
- export default defineWorkspace([ { test: { name: "unit", ... } }, { test: { name: "e2e", ... } } ]);
```

Config already lives in `vitest.config.ts`:

```ts
export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: [...], exclude: ["**/*.e2e.test.ts"] } },
      { extends: true, test: { name: "e2e",  include: ["packages/*/src/**/*.e2e.test.ts"] } },
    ],
  },
});
```

Also update the doc references that pointed at `vitest.workspace.ts` (CLAUDE.md, README.md).

## Why This Works

When a package lists the same dependency in **both** `dependencies` and `peerDependencies`, pnpm
treats it as **peer-satisfiable** and reuses an already-present version from the tree rather than
installing its own in-range copy. With only vitepress's vite 5 present, pnpm satisfied vitest's vite
with vite 5 despite the range mismatch (the warning is easy to miss). Introducing `vite ^7` at the
root puts an in-range version in the tree, so vitest binds to vite 7 while vitepress keeps vite 5.

Result after the fix — the lockfile snapshot reads `vitest@4.1.7(...)(vite@7.3.3...)`, vitepress
still resolves its own `vite@5.4.21`, and there is no `vitest@2.1.9` / `@vitest/coverage-v8@2.1.9`.

## Prevention

- **A green `pnpm test` after a major bump isn't proof the bump is clean.** Here vitest silently
  ignored a stale, broken `vitest.workspace.ts`; only knip caught it. Conversely, a _startup_ crash
  (`ERR_PACKAGE_PATH_NOT_EXPORTED` on a vite subpath) is usually a transitive peer/dedupe issue, not a
  bug in the bumped package.
- **Treat dependabot lockfile edits as partial.** Regenerate and diff `pnpm-lock.yaml` rather than
  trusting the bot; watch for stale old-version entries surviving the bump.
- **Suspect a peer dedupe whenever two tools consume vite with non-overlapping ranges** (vitest ≥4
  wants vite ≥6; vitepress/astro/storybook may pin vite ≤5). `pnpm why vite` showing one shared
  version across both is the tell.
- **Verify the pin and CI parity** after the fix:
  ```bash
  pnpm why vite                       # vite@7 under vitest, vite@5 under vitepress
  grep -nE "vitest@4.*vite@5" pnpm-lock.yaml   # must print nothing
  pnpm install --frozen-lockfile      # clean → CI reproduces the good resolution
  pnpm test                           # green
  pnpm knip                           # exit 0 — no stale vitest.workspace.ts
  ```

Sibling: [[vitest-monorepo-build-and-filter-quirks]] — same vitest + pnpm monorepo harness area, a
different failure mode (build-before-test / glob anchoring vs. this peer-resolution gotcha). Note that
doc references `vitest.workspace.ts`, which this migration **deletes** — the split now lives in
`vitest.config.ts`'s `projects`. The stale-workspace-file cleanup was surfaced by
[[knip-false-positives-in-this-monorepo]].
