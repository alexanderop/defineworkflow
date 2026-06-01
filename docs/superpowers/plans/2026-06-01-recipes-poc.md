# Recipes — shippable, ejectable workflows (POC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use references/subagent-driven-development/SKILL.md (recommended) or references/executing-plans/SKILL.md to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the shadcn-style eject loop — `workflow add deep-research` fetches a versioned recipe blob from a remote registry, writes its multi-file source into `.workflow/workflows/<name>/`, and the existing run-by-name resolver runs it — with real versioning (lockfile + hash) and full deterministic unit tests.

**Architecture:** A new pure-logic module (`recipes.ts`) holds zod schemas + hash/semver/path-safety helpers. A new `add` CLI command (`commands/add.ts`) fetches → validates → version/hash-checks against `.workflow/recipes.lock.json` → writes files → updates lock, all over a new `net` DI capability. `resolve.ts` gains directory-entry resolution so an ejected folder runs by name. A standalone `scripts/build-registry.ts` turns `recipes/` source folders into committed `registry/r/<name>.json` + `registry/index.json` blobs.

**Tech Stack:** TypeScript (ESM, strict), zod (boundary validation), neverthrow style (commands return exit-code `number`, not Results — matches existing CLI commands), node:crypto (sha256), vitest, esbuild (existing bundle step, unchanged).

---

## Deviations from the design doc (recorded, with rationale)

1. **Run-by-name is NOT zero-code.** `resolve.ts` currently resolves only `<name>.ts`/`<name>.js` _files_; eject writes a `<name>/` _directory_. Task 6 adds directory-entry candidates (`<base>/<name>/<name>.workflow.ts`). This is a small, additive change that preserves all existing resolver tests.
2. **`REGISTRY_BASE` repo path.** The doc says `…/alexanderop/workflow/…`; the real repo is `alexanderop/defineworkflow`. Use `https://raw.githubusercontent.com/alexanderop/defineworkflow/main/registry`.
3. **Build script is self-contained.** Node here is v22.22.2 (type-stripping unflagged). To avoid cross-package `.ts` import-resolution risk when running `node scripts/build-registry.ts`, the script uses only `node:` builtins and inlines the ~6-line blob assembly. The _same_ pure logic (`buildBlob`, `parseRecipeVersion`) is exported from `recipes.ts` and unit-tested there (round-trip + missing-`recipe.json`), satisfying the design's "build script test" requirement without a fragile runtime import.
4. **Lock keeps the documented shape** `{version, url, hash, ejectedAt}` (no extra `files` field). On-disk modification is detected by re-hashing the on-disk content at the incoming blob's path set and comparing to `lock.hash`; the "changed files" list shown on refuse is the blob files whose on-disk content differs from the registry content (uses only `io.readText`, no new FS capability).

---

## File Structure

- Create `packages/cli/src/recipes.ts` — REGISTRY_BASE, `recipeUrl`, zod schemas (`RegistryBlob`, `LockEntry`, `RecipesLock`), `hashFiles`, `compareVersions`, `isSafeRelativePath`, `buildBlob`, `parseRecipeVersion`. One home for all recipe logic.
- Create `packages/cli/src/recipes.test.ts` — unit tests for the pure helpers.
- Create `packages/cli/src/commands/add.ts` — `addCommand`.
- Create `packages/cli/src/commands/add.test.ts` — command tests (fake `net` + memFs).
- Modify `packages/cli/src/app.ts` — add `NetDeps` interface + `net` field on `AppDeps`.
- Modify `packages/cli/src/node-deps.ts` — real `net.fetchText` (global `fetch`).
- Modify `packages/cli/src/test-support.ts` — fake `net` + `net?` override.
- Modify `packages/cli/src/dispatch.ts` — `--force` option, `case "add"`, USAGE line.
- Modify `packages/cli/src/resolve.ts` — directory-entry candidates.
- Modify `packages/cli/src/resolve.test.ts` — add directory-entry tests.
- Create `recipes/deep-research/recipe.json` + the 6 source files (copied from `packages/examples/src/deep-research/`).
- Create `scripts/build-registry.ts` — self-contained build script.
- Generate (committed) `registry/r/deep-research.json`, `registry/index.json`.
- Modify `package.json` — `"build:registry"` script.
- Modify `knip.json` — ignore `recipes/**`, `registry/**`, `scripts/**` defensively.

---

## Task 1: Pure recipe helpers (`recipes.ts`)

**Files:** Create `packages/cli/src/recipes.ts`, Test `packages/cli/src/recipes.test.ts`

- [ ] **Step 1: Write the failing test** (`recipes.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import {
  hashFiles,
  compareVersions,
  isSafeRelativePath,
  buildBlob,
  parseRecipeVersion,
  recipeUrl,
  RegistryBlob,
} from "./recipes.js";

describe("hashFiles", () => {
  it("is order-independent", () => {
    const a = hashFiles([
      { path: "a", content: "1" },
      { path: "b", content: "2" },
    ]);
    const b = hashFiles([
      { path: "b", content: "2" },
      { path: "a", content: "1" },
    ]);
    expect(a).toBe(b);
  });
  it("detects a content change", () => {
    const a = hashFiles([{ path: "a", content: "1" }]);
    const b = hashFiles([{ path: "a", content: "2" }]);
    expect(a).not.toBe(b);
  });
  it("is prefixed sha256-", () => {
    expect(hashFiles([{ path: "a", content: "1" }])).toMatch(/^sha256-[0-9a-f]{64}$/);
  });
});

describe("compareVersions", () => {
  it("orders numerically left-to-right", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  it("treats missing trailing parts as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });
});

describe("isSafeRelativePath", () => {
  it("accepts plain relative files", () => {
    expect(isSafeRelativePath("a/b.ts")).toBe(true);
    expect(isSafeRelativePath("deep-research.workflow.ts")).toBe(true);
  });
  it("rejects traversal and absolute paths", () => {
    expect(isSafeRelativePath("../x")).toBe(false);
    expect(isSafeRelativePath("a/../../x")).toBe(false);
    expect(isSafeRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRelativePath("C:\\x")).toBe(false);
    expect(isSafeRelativePath("")).toBe(false);
  });
});

describe("buildBlob / parseRecipeVersion", () => {
  it("assembles a sorted, validatable blob", () => {
    const blob = buildBlob("r", "1.0.0", [
      { path: "z.ts", content: "Z" },
      { path: "a.ts", content: "A" },
    ]);
    expect(blob.files.map((f) => f.path)).toEqual(["a.ts", "z.ts"]);
    expect(RegistryBlob.safeParse(blob).success).toBe(true);
  });
  it("reads version from recipe.json, undefined when missing/invalid", () => {
    expect(parseRecipeVersion('{"version":"1.2.3"}')).toBe("1.2.3");
    expect(parseRecipeVersion("{}")).toBeUndefined();
    expect(parseRecipeVersion("not json")).toBeUndefined();
    expect(parseRecipeVersion(undefined)).toBeUndefined();
  });
});

describe("recipeUrl", () => {
  it("builds the raw registry url", () => {
    expect(recipeUrl("deep-research")).toBe(
      "https://raw.githubusercontent.com/alexanderop/defineworkflow/main/registry/r/deep-research.json",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/src/recipes.test.ts`
Expected: FAIL — cannot resolve `./recipes.js`.

- [ ] **Step 3: Write minimal implementation** (`recipes.ts`)

```ts
import { z } from "zod";
import crypto from "node:crypto";

/** Hardcoded for the POC (design §Future layering: swap for a config resolver later). */
export const REGISTRY_BASE =
  "https://raw.githubusercontent.com/alexanderop/defineworkflow/main/registry";

export const recipeUrl = (name: string): string => `${REGISTRY_BASE}/r/${name}.json`;

export const RegistryBlob = z.object({
  name: z.string(),
  version: z.string(),
  files: z.array(z.object({ path: z.string(), content: z.string() })),
});
export type RegistryBlob = z.infer<typeof RegistryBlob>;

export const LockEntry = z.object({
  version: z.string(),
  url: z.string(),
  hash: z.string(),
  ejectedAt: z.number(),
});
export type LockEntry = z.infer<typeof LockEntry>;

export const RecipesLock = z.record(z.string(), LockEntry);
export type RecipesLock = z.infer<typeof RecipesLock>;

export interface RecipeFileData {
  readonly path: string;
  readonly content: string;
}

const byPath = (a: RecipeFileData, b: RecipeFileData): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** Canonical, order-independent sha256 of a recipe's file set. */
export function hashFiles(files: readonly RecipeFileData[]): string {
  const h = crypto.createHash("sha256");
  for (const f of [...files].sort(byPath)) h.update(`${f.path}\0${f.content}\0`);
  return `sha256-${h.digest("hex")}`;
}

/** Dotted-numeric semver compare: -1 if a<b, 0 if equal, 1 if a>b. Missing parts = 0. */
export function compareVersions(a: string, b: string): number {
  const toParts = (v: string): number[] =>
    v.split(".").map((n) => {
      const x = Number(n);
      return Number.isFinite(x) ? x : 0;
    });
  const pa = toParts(a);
  const pb = toParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** Reject absolute paths and `..` traversal — defense against a malicious blob. */
export function isSafeRelativePath(p: string): boolean {
  if (p.length === 0) return false;
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return false;
  const parts = p.split(/[\\/]/);
  return !parts.includes("..") && !parts.includes("");
}

/** Assemble a deterministic, sorted blob (used by the build script + tests). */
export function buildBlob(
  name: string,
  version: string,
  files: readonly RecipeFileData[],
): RegistryBlob {
  return {
    name,
    version,
    files: [...files].sort(byPath).map((f) => ({ path: f.path, content: f.content })),
  };
}

/** Read `version` from a recipe.json payload; undefined when missing/invalid. */
export function parseRecipeVersion(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  try {
    const r = z.object({ version: z.string() }).safeParse(JSON.parse(raw));
    return r.success ? r.data.version : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/src/recipes.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/recipes.ts packages/cli/src/recipes.test.ts
git commit -m "feat(cli): recipe helpers — schemas, hash, semver, path-safety"
```

---

## Task 2: `net` DI capability

**Files:** Modify `packages/cli/src/app.ts`, `packages/cli/src/node-deps.ts`, `packages/cli/src/test-support.ts`

- [ ] **Step 1: Add `NetDeps` to `app.ts`**

After the `UiDeps` interface, add:

```ts
/** Outbound network as text — the only network capability in the CLI. */
export interface NetDeps {
  /** Fetch a URL as text. Returns undefined on a non-2xx / network failure. */
  fetchText(url: string): Promise<string | undefined>;
}
```

In `interface AppDeps`, add the field (next to `ui`):

```ts
  readonly net: NetDeps;
```

- [ ] **Step 2: Real impl in `node-deps.ts`**

In the returned object (next to `ui:`), add:

```ts
    net: {
      fetchText: async (url) => {
        try {
          const res = await fetch(url);
          return res.ok ? await res.text() : undefined;
        } catch {
          return undefined;
        }
      },
    },
```

- [ ] **Step 3: Fake in `test-support.ts`**

Add to the `import type { ... } from "./app.js"` list: `NetDeps`.
Add to `FakeDepsOverrides`: `net?: Partial<NetDeps>;` (after `ui?`).
Add to the `deps` object (after `ui:`):

```ts
    net: { fetchText: async () => undefined, ...o.net },
```

- [ ] **Step 4: Verify it compiles + existing tests still pass**

Run: `pnpm --filter @workflow/cli build && pnpm vitest run packages/cli/src/commands/commands.test.ts`
Expected: build clean, dispatch tests still PASS (no `net` usage yet, so adding the field is non-breaking for fakes).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/app.ts packages/cli/src/node-deps.ts packages/cli/src/test-support.ts
git commit -m "feat(cli): add net.fetchText DI capability"
```

---

## Task 3: `add` command

**Files:** Create `packages/cli/src/commands/add.ts`, Test `packages/cli/src/commands/add.test.ts`

- [ ] **Step 1: Write the failing test** (`add.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { addCommand } from "./add.js";
import { fakeDeps } from "../test-support.js";
import { hashFiles, recipeUrl } from "../recipes.js";

const NAME = "deep-research";
const DIR = `/proj/.workflow/workflows/${NAME}`;
const LOCK = `/proj/.workflow/recipes.lock.json`;

const blob = (version: string, files: { path: string; content: string }[]) =>
  JSON.stringify({ name: NAME, version, files });

const FILES = [
  { path: "deep-research.workflow.ts", content: "export default {}\n" },
  { path: "schemas.ts", content: "export const X = 1\n" },
];

function depsWith(blobJson: string | undefined, files: Record<string, string> = {}) {
  return fakeDeps({ _files: files, net: { fetchText: async () => blobJson } });
}

describe("addCommand", () => {
  it("first eject writes files and creates the lock", async () => {
    const { deps } = depsWith(blob("1.0.0", FILES));
    const code = await addCommand({ name: NAME, force: false }, deps);
    expect(code).toBe(0);
    expect(deps.io.readText(`${DIR}/deep-research.workflow.ts`)).toBe("export default {}\n");
    expect(deps.io.readText(`${DIR}/schemas.ts`)).toBe("export const X = 1\n");
    const lock = JSON.parse(deps.io.readText(LOCK)!);
    expect(lock[NAME].version).toBe("1.0.0");
    expect(lock[NAME].url).toBe(recipeUrl(NAME));
    expect(lock[NAME].hash).toBe(hashFiles(FILES));
    expect(typeof lock[NAME].ejectedAt).toBe("number");
  });

  it("up-to-date version is a no-op", async () => {
    const seed: Record<string, string> = {
      [`${DIR}/deep-research.workflow.ts`]: FILES[0]!.content,
      [`${DIR}/schemas.ts`]: FILES[1]!.content,
      [LOCK]: JSON.stringify({
        [NAME]: { version: "1.0.0", url: recipeUrl(NAME), hash: hashFiles(FILES), ejectedAt: 1 },
      }),
    };
    const { deps, out } = depsWith(blob("1.0.0", FILES), seed);
    expect(await addCommand({ name: NAME, force: false }, deps)).toBe(0);
    expect(out()).toContain("already up to date");
  });

  it("newer + unmodified → clean overwrite + lock bump", async () => {
    const seed: Record<string, string> = {
      [`${DIR}/deep-research.workflow.ts`]: FILES[0]!.content,
      [`${DIR}/schemas.ts`]: FILES[1]!.content,
      [LOCK]: JSON.stringify({
        [NAME]: { version: "1.0.0", url: recipeUrl(NAME), hash: hashFiles(FILES), ejectedAt: 1 },
      }),
    };
    const NEW = [
      { path: "deep-research.workflow.ts", content: "export default { v: 2 }\n" },
      { path: "schemas.ts", content: "export const X = 2\n" },
    ];
    const { deps } = depsWith(blob("2.0.0", NEW), seed);
    expect(await addCommand({ name: NAME, force: false }, deps)).toBe(0);
    expect(deps.io.readText(`${DIR}/deep-research.workflow.ts`)).toBe("export default { v: 2 }\n");
    expect(JSON.parse(deps.io.readText(LOCK)!)[NAME].version).toBe("2.0.0");
  });

  it("newer + modified → refused without --force, lists changed files", async () => {
    const seed: Record<string, string> = {
      [`${DIR}/deep-research.workflow.ts`]: "LOCAL EDIT\n",
      [`${DIR}/schemas.ts`]: FILES[1]!.content,
      [LOCK]: JSON.stringify({
        [NAME]: { version: "1.0.0", url: recipeUrl(NAME), hash: hashFiles(FILES), ejectedAt: 1 },
      }),
    };
    const { deps, out } = depsWith(blob("2.0.0", FILES), seed);
    expect(await addCommand({ name: NAME, force: false }, deps)).toBe(1);
    expect(out()).toContain("local modifications");
    expect(out()).toContain("deep-research.workflow.ts");
    // file not overwritten
    expect(deps.io.readText(`${DIR}/deep-research.workflow.ts`)).toBe("LOCAL EDIT\n");
  });

  it("--force overwrites regardless", async () => {
    const seed: Record<string, string> = {
      [`${DIR}/deep-research.workflow.ts`]: "LOCAL EDIT\n",
      [LOCK]: JSON.stringify({
        [NAME]: { version: "1.0.0", url: recipeUrl(NAME), hash: "sha256-stale", ejectedAt: 1 },
      }),
    };
    const { deps } = depsWith(blob("2.0.0", FILES), seed);
    expect(await addCommand({ name: NAME, force: true }, deps)).toBe(0);
    expect(deps.io.readText(`${DIR}/deep-research.workflow.ts`)).toBe(FILES[0]!.content);
    expect(JSON.parse(deps.io.readText(LOCK)!)[NAME].version).toBe("2.0.0");
  });

  it("404 / missing recipe → clear error, no files written", async () => {
    const { deps, out } = depsWith(undefined);
    expect(await addCommand({ name: NAME, force: false }, deps)).toBe(1);
    expect(out()).toContain('unknown recipe "deep-research"');
    expect(deps.io.readText(`${DIR}/schemas.ts`)).toBeUndefined();
  });

  it("malformed blob → clear error, no files written", async () => {
    const { deps, out } = depsWith('{"name":"x"}'); // missing version + files
    expect(await addCommand({ name: NAME, force: false }, deps)).toBe(1);
    expect(out()).toContain("invalid registry blob");
    expect(deps.io.readText(`${DIR}/schemas.ts`)).toBeUndefined();
  });

  it("path-escape in a blob is rejected, no files written", async () => {
    const evil = blob("1.0.0", [{ path: "../../evil.ts", content: "x" }]);
    const { deps, out } = depsWith(evil);
    expect(await addCommand({ name: NAME, force: false }, deps)).toBe(1);
    expect(out()).toContain("unsafe file path");
    expect(deps.io.readText("/proj/.workflow/workflows/evil.ts")).toBeUndefined();
  });

  it("untracked existing directory is refused without --force", async () => {
    const seed: Record<string, string> = {
      [`${DIR}/deep-research.workflow.ts`]: "PRE-EXISTING\n",
    };
    const { deps, out } = depsWith(blob("1.0.0", FILES), seed);
    expect(await addCommand({ name: NAME, force: false }, deps)).toBe(1);
    expect(out()).toContain("already exists");
    expect(deps.io.readText(`${DIR}/deep-research.workflow.ts`)).toBe("PRE-EXISTING\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/src/commands/add.test.ts`
Expected: FAIL — cannot resolve `./add.js`.

- [ ] **Step 3: Write minimal implementation** (`add.ts`)

```ts
import type { AppDeps } from "../app.js";
import {
  recipeUrl,
  RegistryBlob,
  RecipesLock,
  type LockEntry,
  hashFiles,
  compareVersions,
  isSafeRelativePath,
} from "../recipes.js";

export interface AddArgs {
  readonly name: string;
  readonly force: boolean;
}

type AddDeps = Pick<AppDeps, "net" | "io" | "clock" | "env" | "ui">;

/** Fetch a recipe blob, version/hash-check it against the lockfile, eject its files. */
export async function addCommand(args: AddArgs, deps: AddDeps): Promise<number> {
  const { name, force } = args;
  const url = recipeUrl(name);

  const text = await deps.net.fetchText(url);
  if (text === undefined) {
    deps.ui.print(`error: unknown recipe "${name}"\n`);
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    deps.ui.print(`error: recipe "${name}" returned invalid JSON\n`);
    return 1;
  }
  const blobResult = RegistryBlob.safeParse(parsed);
  if (!blobResult.success) {
    deps.ui.print(`error: recipe "${name}" has an invalid registry blob\n`);
    return 1;
  }
  const blob = blobResult.data;

  const unsafe = blob.files.filter((f) => !isSafeRelativePath(f.path));
  if (unsafe.length > 0) {
    deps.ui.print(
      `error: recipe "${name}" contains unsafe file path(s): ${unsafe
        .map((f) => f.path)
        .join(", ")}\n`,
    );
    return 1;
  }

  const dir = `${deps.env.cwd}/.workflow/workflows/${name}`;
  const lockPath = `${deps.env.cwd}/.workflow/recipes.lock.json`;
  const onDisk = (p: string): string | undefined => deps.io.readText(`${dir}/${p}`);

  let lock: RecipesLock = {};
  const lockRaw = deps.io.readText(lockPath);
  if (lockRaw !== undefined) {
    try {
      const r = RecipesLock.safeParse(JSON.parse(lockRaw));
      if (r.success) lock = r.data;
    } catch {
      // unreadable lock → treat as empty; --force still works
    }
  }
  const entry = lock[name];
  const blobHash = hashFiles(blob.files);

  if (!force) {
    if (entry) {
      if (compareVersions(blob.version, entry.version) <= 0) {
        deps.ui.print(`${name} is already up to date (v${entry.version})\n`);
        return 0;
      }
      const onDiskHash = hashFiles(
        blob.files.map((f) => ({ path: f.path, content: onDisk(f.path) ?? "" })),
      );
      if (onDiskHash !== entry.hash) {
        const changed = blob.files.filter((f) => (onDisk(f.path) ?? "") !== f.content);
        deps.ui.print(
          `error: ${name} has local modifications; refusing to overwrite.\n` +
            `Divergent files:\n` +
            changed.map((f) => `  - ${f.path}`).join("\n") +
            `\nRe-run with --force to overwrite.\n`,
        );
        return 1;
      }
    } else if (blob.files.some((f) => onDisk(f.path) !== undefined)) {
      deps.ui.print(
        `error: ${dir} already exists but is not tracked in the lockfile; ` +
          `re-run with --force to overwrite.\n`,
      );
      return 1;
    }
  }

  for (const f of blob.files) deps.io.writeText(`${dir}/${f.path}`, f.content);

  const newEntry: LockEntry = {
    version: blob.version,
    url,
    hash: blobHash,
    ejectedAt: deps.clock.now(),
  };
  deps.io.writeText(lockPath, `${JSON.stringify({ ...lock, [name]: newEntry }, null, 2)}\n`);

  deps.ui.print(`added ${name}@${blob.version} → ${dir}\nnext: workflow ${name} --args '{…}'\n`);
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/src/commands/add.test.ts`
Expected: PASS (all 9 cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/add.ts packages/cli/src/commands/add.test.ts
git commit -m "feat(cli): workflow add <name> — fetch, version/hash-check, eject"
```

---

## Task 4: Wire `add` into the dispatcher

**Files:** Modify `packages/cli/src/dispatch.ts`, Test `packages/cli/src/commands/commands.test.ts`

- [ ] **Step 1: Write the failing test** (append to `commands.test.ts`'s `describe("dispatch routing", …)`)

```ts
it("add requires a recipe name", async () => {
  const { deps, out } = fakeDeps();
  expect(await dispatch(["add"], deps)).toBe(1);
  expect(out()).toContain("add requires a recipe name");
});

it("add fetches and ejects a recipe by name", async () => {
  const blobJson = JSON.stringify({
    name: "demo",
    version: "1.0.0",
    files: [{ path: "demo.workflow.ts", content: "export default {}\n" }],
  });
  const { deps, out } = fakeDeps({ net: { fetchText: async () => blobJson } });
  expect(await dispatch(["add", "demo"], deps)).toBe(0);
  expect(out()).toContain("added demo@1.0.0");
  expect(deps.io.readText("/proj/.workflow/workflows/demo/demo.workflow.ts")).toBe(
    "export default {}\n",
  );
});

it("add passes --force through", async () => {
  const blobJson = JSON.stringify({ name: "demo", version: "2.0.0", files: [] });
  const { deps } = fakeDeps({
    net: { fetchText: async () => blobJson },
    _files: { "/proj/.workflow/workflows/demo/x.ts": "edited" },
  });
  expect(await dispatch(["add", "demo", "--force"], deps)).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/src/commands/commands.test.ts -t "add"`
Expected: FAIL — `add` falls through to "unknown command or workflow 'add'".

- [ ] **Step 3: Implement** in `dispatch.ts`

Add the import near the other command imports:

```ts
import { addCommand } from "./commands/add.js";
```

Add `force` to the `parseArgs` options object:

```ts
        force: { type: "boolean" },
```

Add the USAGE line (after the `run` line):

```
  workflow add <name> [--force]  fetch a recipe from the registry into .workflow/workflows/
```

Add the case (before `default:`):

```ts
    case "add": {
      const recipe = positionals[1];
      if (recipe === undefined) {
        deps.ui.print("error: add requires a recipe name\n");
        return 1;
      }
      return addCommand({ name: recipe, force: values["force"] === true }, deps);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/src/commands/commands.test.ts`
Expected: PASS (new + existing dispatch tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/dispatch.ts packages/cli/src/commands/commands.test.ts
git commit -m "feat(cli): route 'workflow add <name> [--force]'"
```

---

## Task 5: Directory-entry resolution (run-by-name on an ejected folder)

**Files:** Modify `packages/cli/src/resolve.ts`, Test `packages/cli/src/resolve.test.ts`

- [ ] **Step 1: Write the failing test** (append to `resolve.test.ts`)

```ts
it("resolves a multi-file recipe folder by its entry file", () => {
  const entry = "/proj/.workflow/workflows/deep-research/deep-research.workflow.ts";
  const r = resolveSavedWorkflow("deep-research", deps({ [entry]: "ENTRY" }));
  expect(r?.source).toBe("ENTRY");
  expect(r?.path).toBe(entry);
});

it("single-file copy beats a folder entry of the same name", () => {
  const file = "/proj/.workflow/workflows/deep.ts";
  const entry = "/proj/.workflow/workflows/deep/deep.workflow.ts";
  const r = resolveSavedWorkflow("deep", deps({ [file]: "FILE", [entry]: "FOLDER" }));
  expect(r?.source).toBe("FILE");
});

it("project folder beats a personal folder", () => {
  const proj = "/proj/.workflow/workflows/deep/deep.workflow.ts";
  const home = "/home/me/.workflow/workflows/deep/deep.workflow.ts";
  const r = resolveSavedWorkflow("deep", deps({ [proj]: "PROJECT", [home]: "HOME" }));
  expect(r?.source).toBe("PROJECT");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/src/resolve.test.ts`
Expected: FAIL — folder-entry cases return undefined.

- [ ] **Step 3: Implement** — replace the `candidates` array body in `resolveSavedWorkflow`:

```ts
const bases = [
  `${deps.cwd}/.workflow/workflows`,
  `${deps.homeDir}/.workflow/workflows`,
  ...(deps.bundledDir ? [deps.bundledDir] : []),
];
// Per base, in precedence order: single-file `.ts`/`.js`, then a multi-file folder entry
// `<name>/<name>.workflow.ts`/`.js`. Tier precedence (project → personal → bundled) is the
// order of `bases`, so a single-file or folder copy in an earlier tier wins.
const candidates = bases.flatMap((base) => [
  `${base}/${name}.ts`,
  `${base}/${name}.js`,
  `${base}/${name}/${name}.workflow.ts`,
  `${base}/${name}/${name}.workflow.js`,
]);
```

(Leave the trailing `for (const path of candidates) { … }` loop unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/src/resolve.test.ts`
Expected: PASS — all original + 3 new cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/resolve.ts packages/cli/src/resolve.test.ts
git commit -m "feat(cli): resolve multi-file recipe folders by name"
```

---

## Task 6: Recipe source + build script + generated registry

**Files:** Create `recipes/deep-research/**`, `scripts/build-registry.ts`, generated `registry/**`; Modify `package.json`, `knip.json`

- [ ] **Step 1: Seed the recipe source**

```bash
mkdir -p recipes/deep-research
cp packages/examples/src/deep-research/deep-research.workflow.ts recipes/deep-research/
cp packages/examples/src/deep-research/lib.ts recipes/deep-research/
cp packages/examples/src/deep-research/prompts.ts recipes/deep-research/
cp packages/examples/src/deep-research/schemas.ts recipes/deep-research/
cp packages/examples/src/deep-research/types.ts recipes/deep-research/
printf '{ "version": "1.0.0" }\n' > recipes/deep-research/recipe.json
```

- [ ] **Step 2: Write the build script** (`scripts/build-registry.ts`) — self-contained, node builtins only

```ts
#!/usr/bin/env node
// Turn each recipes/<name>/ folder into a committed registry blob.
//   recipes/<name>/recipe.json  → { version }
//   recipes/<name>/**           → files: [{ path, content }]  (recipe.json excluded)
// Output: registry/r/<name>.json + registry/index.json. Run via `pnpm build:registry`.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, relative, posix, sep } from "node:path";

const ROOT = process.cwd();
const RECIPES = join(ROOT, "recipes");
const OUT_DIR = join(ROOT, "registry");
const OUT_R = join(OUT_DIR, "r");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function buildRecipe(name: string): {
  version: string;
  files: { path: string; content: string }[];
} {
  const root = join(RECIPES, name);
  const recipeJsonRaw = readFileSync(join(root, "recipe.json"), "utf8");
  const version: unknown = JSON.parse(recipeJsonRaw).version;
  if (typeof version !== "string") {
    throw new Error(`recipes/${name}/recipe.json: missing or non-string "version"`);
  }
  const files = walk(root)
    .map((full) => ({ rel: relative(root, full).split(sep).join(posix.sep), full }))
    .filter((f) => f.rel !== "recipe.json")
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
    .map((f) => ({ path: f.rel, content: readFileSync(f.full, "utf8") }));
  return { version, files };
}

const names = readdirSync(RECIPES).filter((n) => statSync(join(RECIPES, n)).isDirectory());
mkdirSync(OUT_R, { recursive: true });
const index: { name: string; version: string }[] = [];
for (const name of names) {
  const { version, files } = buildRecipe(name);
  writeFileSync(
    join(OUT_R, `${name}.json`),
    `${JSON.stringify({ name, version, files }, null, 2)}\n`,
  );
  index.push({ name, version });
}
index.sort((a, b) => (a.name < b.name ? -1 : 1));
writeFileSync(join(OUT_DIR, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`built ${index.length} recipe(s): ${index.map((r) => r.name).join(", ")}`);
```

- [ ] **Step 3: Add the package.json script**

In `package.json` `"scripts"`, add:

```json
    "build:registry": "node scripts/build-registry.ts",
```

- [ ] **Step 4: Defensive knip ignores** — in `knip.json`, change `"ignore"` to:

```json
  "ignore": ["repos/**", ".claude/**", ".agents/**", "recipes/**", "registry/**", "scripts/**"],
```

- [ ] **Step 5: Run the build script and verify output**

Run: `pnpm build:registry`
Expected: prints `built 1 recipe(s): deep-research`; creates `registry/r/deep-research.json` (with `name`, `version: "1.0.0"`, and a `files` array including `deep-research.workflow.ts`, `schemas.ts`, `prompts.ts`, `lib.ts`, `types.ts`) and `registry/index.json` = `[{ "name": "deep-research", "version": "1.0.0" }]`.

Verify: `node -e "const b=require('./registry/r/deep-research.json'); console.log(b.name, b.version, b.files.map(f=>f.path).sort())"`
Expected: `deep-research 1.0.0 [ 'deep-research.workflow.ts', 'lib.ts', 'prompts.ts', 'schemas.ts', 'types.ts' ]`

- [ ] **Step 6: Commit**

```bash
git add recipes registry scripts package.json knip.json
git commit -m "feat: deep-research recipe source + build-registry script + generated blobs"
```

---

## Task 7: Full verification sweep

- [ ] **Step 1:** `pnpm build` — all packages build clean.
- [ ] **Step 2:** `pnpm typecheck` — no type errors.
- [ ] **Step 3:** `pnpm lint` — oxlint clean (recipes/, scripts/, registry/ included).
- [ ] **Step 4:** `pnpm format:check` (run `pnpm format` first if it fails) — formatting clean.
- [ ] **Step 5:** `pnpm test` — full unit suite green.
- [ ] **Step 6:** `pnpm knip` — no new unused-code findings (recipes/registry/scripts ignored).
- [ ] **Step 7:** End-to-end smoke (no tokens): confirm `add` → run-by-name resolves the ejected folder. Build the CLI, then from a temp cwd run `workflow add deep-research` against a _local file URL_ is not wired (POC uses a hardcoded https base), so instead assert the loop via the unit tests already covering (a) `add` writes `.workflow/workflows/deep-research/deep-research.workflow.ts` and (b) `resolveSavedWorkflow("deep-research")` finds that exact path. Document that a live fetch requires the registry blobs to be pushed to `main` (the hardcoded raw URL) — which Task 6's committed `registry/` provides once merged.

---

## Self-Review

- **Spec coverage:** Piece 1 (recipe source + build script) → Task 6. Piece 2 (`add` command, all 6 steps incl. path-escape) → Tasks 2–4. Piece 3 (run-by-name) → Task 5 (with the documented deviation). Versioning (lock, hash, semver, decision matrix, first-eject, untracked-dir) → Task 1 (pure) + Task 3 (matrix). Data shapes (RegistryBlob/LockEntry/RecipesLock) → Task 1. DI (`net`) → Task 2. Testing list → Tasks 1 & 3 cover every bullet (first eject, up-to-date, newer+unmodified, newer+modified, --force, malformed/404, path-escape; hash order-independence/modify-detection; semver ordering/equal/lower; build round-trip + missing recipe.json).
- **Placeholder scan:** none — every step has full code/commands.
- **Type consistency:** `RecipeFileData`, `RegistryBlob`, `LockEntry`, `RecipesLock`, `hashFiles`, `compareVersions`, `isSafeRelativePath`, `buildBlob`, `parseRecipeVersion`, `recipeUrl`, `REGISTRY_BASE`, `NetDeps.fetchText`, `addCommand(AddArgs, AddDeps)` are named identically across all tasks.
