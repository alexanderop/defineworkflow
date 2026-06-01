---
title: "Recipes eject loop: shadcn-style 'workflow add' — run-by-name needs directory resolution, not zero code"
date: 2026-06-01
track: knowledge
category: architecture-patterns
problem_type: "sandbox_execution_model"
module: "cli"
component: "add"
tags:
  [
    "recipes",
    "eject",
    "shadcn",
    "registry",
    "workflow-add",
    "versioning",
    "lockfile",
    "resolve",
    "run-by-name",
    "net-capability",
    "build-registry",
  ]
applies_when: "adding/extending the recipes feature, the `workflow add` command, the registry build script, run-by-name resolution of multi-file workflows, or a new outbound-network CLI capability"
---

# Recipes eject loop: `workflow add` + run-by-name on an ejected folder

## Context

A **recipe** is a proven workflow shipped shadcn-style: not a dependency you call into, but
**source you own and edit**. `workflow add <name>` fetches a versioned blob from a remote registry
and writes its files into the consuming repo's `.workflow/workflows/<name>/`, after which the
existing run-by-name path runs it. The POC loop is: `recipes/<name>/` source →
`scripts/build-registry.ts` → committed `registry/r/<name>.json` (one self-contained blob, files
inline) + `registry/index.json` → `workflow add` fetches/validates/version-checks/ejects →
`workflow <name>` runs it.

## Guidance

- **Run-by-name is NOT zero new code — `resolve.ts` only matched files.** The natural assumption
  ("eject writes a folder, the resolver already finds it") is wrong: `resolveSavedWorkflow` resolved
  only `<base>/<name>.ts` / `<name>.js` _files_, never a `<name>/` _directory_. Eject writes a
  multi-file **folder** (`.workflow/workflows/<name>/<name>.workflow.ts` + helpers). The fix is small
  and additive — add folder-entry candidates per tier:
  `[ `${base}/${name}.ts`, `${base}/${name}.js`, `${base}/${name}/${name}.workflow.ts`, `${base}/${name}/${name}.workflow.js` ]`,
  flat-mapped over the project → personal → bundled bases. Single-file still beats folder within a
  tier; all existing resolver tests stay byte-identical. **Always check `resolve.ts` before claiming
  a name-resolution change is free.**

- **The ejected folder runs for free _after_ resolution** because `runCommand` bundles relative
  imports from the entry path at read-time via the existing esbuild step (see
  [[multi-file-workflows-esbuild-bundle]]). `add` writes real files to disk, so esbuild's
  `resolveDir` finds the siblings — no runtime change. The only gap was getting the resolver to
  return the entry path.

- **`net: { fetchText(url): Promise<string | undefined> }` is the whole network capability.** Add it
  to `AppDeps` as its own role (real impl = global `fetch`, non-2xx/throw → `undefined`; fake in
  `fakeDeps` defaults to `undefined`, override with `net: { fetchText: async () => blobJson }`). A
  capability this narrow keeps `add` deterministically unit-testable with zero real network, and the
  command declares only `Pick<AppDeps, "net" | "io" | "clock" | "env" | "ui">`.

- **A corrupt lockfile must FAIL, never silently reset to `{}`.** The lock
  (`.workflow/recipes.lock.json`) is a per-recipe map; the write is `{ ...lock, [name]: newEntry }`.
  If you load it as "parse → `if (success) lock = data` → else stay `{}`", a _valid-JSON but
  schema-invalid_ lock (one stale/hand-edited entry) resets `lock` to `{}` and the next write
  **clobbers every other recipe's entry**. Fix: when the file exists and is non-empty, fail fast
  (`return 1`, "fix or delete it") on both `JSON.parse` throw and `safeParse` failure.

- **Determinism in the helpers:** hash the file set order-independently (sort by path, then
  `sha256(path + "\0" + content + "\0" …)`, prefixed `sha256-`) so the same function hashes both the
  fetched blob and the on-disk files for modify-detection. Semver compare is a dotted-numeric tuple
  (missing parts = 0, non-numeric = 0); a registry version `<=` the installed one is "up to date"
  (never auto-downgrade). Reject empty file sets (`z.array(...).min(1)`) so `add` can't "succeed" by
  writing nothing. `isSafeRelativePath` rejects absolute (`/…`, `C:…`) and any `..`/empty segment —
  the path-escape defense against a malicious blob.

- **Build script can import the package's tested helpers without a build step.** `node
scripts/build-registry.ts` (Node ≥22.18 strips types) importing `../packages/cli/src/recipes.ts`
  works because Node resolves that file's bare `zod` import from the **cli package's** `node_modules`
  (walking up from the imported file's dir), even though `zod` isn't hoisted to the repo root. This
  lets the script reuse `buildBlob`/`parseRecipeVersion` instead of duplicating walk/sort/parse —
  eliminating drift between the script and the library `add` validates against.

## Why This Matters

The eject model's whole value is "run a proven workflow with zero new glue." That promise hinges on
the _one_ non-obvious piece — directory-entry resolution — that the design under-counted. Everything
else (bundling, registry snapshot, save/resume) already works for free. Getting the lockfile failure
mode right is what makes "update safely without clobbering local edits" actually safe rather than a
data-loss footgun.

## When to Apply

- Adding recipes, editing `commands/add.ts`, `recipes.ts`, `scripts/build-registry.ts`, or the
  generated `registry/`.
- Any change to run-by-name resolution (`resolve.ts`) for multi-file/folder workflows.
- Adding a new outbound-network or other host capability to `AppDeps`.
- Debugging "added the recipe but `workflow <name>` says unknown workflow" (resolver didn't get the
  folder-entry candidates) or a lockfile that lost sibling entries after an `add`.

## Examples

```ts
// resolve.ts — folder-entry candidates per tier (project → personal → bundled)
const candidates = bases.flatMap((base) => [
  `${base}/${name}.ts`,
  `${base}/${name}.js`,
  `${base}/${name}/${name}.workflow.ts`,
  `${base}/${name}/${name}.workflow.js`,
]);

// add.ts — corrupt lock fails fast instead of clobbering siblings
if (lockRaw !== undefined && lockRaw.trim().length > 0) {
  let lockJson: unknown;
  try {
    lockJson = JSON.parse(lockRaw);
  } catch {
    deps.ui.print(`error: ${lockPath} is not valid JSON; fix or delete it before running add\n`);
    return 1;
  }
  const r = RecipesLock.safeParse(lockJson);
  if (!r.success) {
    deps.ui.print(
      `error: ${lockPath} is corrupt (does not match the lockfile schema); fix or delete it\n`,
    );
    return 1;
  }
  lock = r.data;
}
```

Known POC limitation: modify-detection hashes the on-disk content at the _incoming_ blob's path set,
so a newer version that adds/removes files can false-flag an unmodified checkout as "modified"
(resolved by `--force`); orphan files from a removed-file version are not pruned. Acceptable because
it is fail-safe (refuses rather than clobbers).
