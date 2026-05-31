# Multi-file Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workflow be split across a folder — a slim entry file with `defineWorkflow` + `run()`, importing zod schemas and prompt/helper functions from local files via relative imports — so the orchestration reads like a table of contents.

**Architecture:** Add one esbuild **bundle step** in the CLI that inlines the entry's local relative imports into a single self-contained source string before anything else touches it. That bundled string flows through the existing pipeline unchanged: meta extraction, the consent gate, the registry snapshot (so resume/detach/save are self-contained for free), and the `vm` sandbox. Two small additive changes in `packages/core/src/sandbox.ts` teach `transformScript` and `extractMeta` to recognize esbuild's bundled default-export shape. Imports are restricted to local files + `"defineworkflow"` (enforced at bundle time), so determinism is preserved by construction. Single-file workflows with no local imports skip bundling entirely and behave byte-identically to today.

**Tech Stack:** TypeScript (strict, ESM), esbuild (already a `@workflow/core` dep; added to `@workflow/cli`), neverthrow `Result`, vitest, zod.

---

## Background the implementer needs

Read these before starting:

- `docs/superpowers/specs/2026-05-31-multi-file-workflows-design.md` — the approved design.
- `packages/core/src/sandbox.ts` — `transformScript` (script → runnable IIFE), `extractMeta`/`locateMetaLiteral` (static meta read), `stripWorkflowImports`, `runInSandbox`.
- `packages/cli/src/commands/run.ts` — reads the script string, extracts meta, gates consent, snapshots to the registry, runs.
- `docs/solutions/architecture-patterns/workflow-sandbox-script-constraints.md`.

### Key facts established during design (do not re-derive)

1. **The `source` string is the unit of persistence.** `run.ts` reads it, `registry.init(meta, source)` snapshots it to `script.snapshot`, and `run-detached`/`resume`/`save` all replay from that snapshot. Bundle once at read-time and store the bundle → every downstream consumer is self-contained automatically.

2. **esbuild's ESM bundle output** for `export default defineWorkflow(...)` is (verified):
   ```js
   import { agent, defineWorkflow } from "defineworkflow";
   import { z } from "defineworkflow";
   var ResearchSchema = z.object({ summary: z.string() });
   var entry_workflow_default = defineWorkflow({
     name: "spike", description: "d", harness: "claude",
     async run() { return await agent("hi", { schema: ResearchSchema }); }
   });
   export {
     entry_workflow_default as default
   };
   ```
   - Multiple `import ... from "defineworkflow"` lines — the existing `stripWorkflowImports` regex (`/gm`) strips each one.
   - `export default` becomes `var <name> = defineWorkflow({...})` + `export { <name> as default }`. The `<name>` is filename-derived, so capture it; don't hardcode.
   - After stripping the imports there are **no** other imports (helpers are inlined), so the bundle runs as a plain script in the sandbox with `z`/`agent`/`defineWorkflow` resolved as injected globals.

3. **esbuild resolves `.ts` extensions by default**, so `import { x } from "./schemas"` finds `schemas.ts` (verified in the spike).

4. **Determinism is preserved**: `Date.now()`/`Math.random()`/argless `new Date()` remain banned as sandbox globals, and bundled helper code runs inside that same sandbox. Restricting imports to local-files-only means no npm package can smuggle in clocks/fs/network.

---

## File Structure

- **Create** `packages/cli/src/bundle.ts` — `bundleWorkflow({ path, source })`: detect local imports; passthrough if none; else esbuild-bundle with a local-only resolve plugin. Returns `Result<string, string>`.
- **Create** `packages/cli/src/bundle.test.ts` — unit tests over real temp fixture files.
- **Modify** `packages/cli/package.json` — add `esbuild` to `dependencies`.
- **Modify** `packages/core/src/sandbox.ts` — `transformScript` bundled-default branch; `locateMetaLiteral` bundled fallback.
- **Modify** `packages/core/src/sandbox.test.ts` — bundled-shape tests for `transformScript`/`runInSandbox` and `extractMeta`.
- **Modify** `packages/cli/src/commands/run.ts` — bundle the entry before meta/consent/registry; thread the bundle as `source`.
- **Modify** `packages/cli/src/commands/run.test.ts` (or create if absent) — multi-file run via fakeDeps + `--mock`.
- **Create** `packages/examples/src/multi-file-haiku/` — a small dogfood example (entry + `schemas.ts` + `prompts.ts`).
- **Modify** `CLAUDE.md` — document the multi-file authoring model and the local-only import rule.
- **Create** a `docs/solutions/` entry via the `compound` skill after the work is verified.

---

## Task 1: Add esbuild dependency to the CLI package

**Files:**
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Add the dependency**

In `packages/cli/package.json`, add `esbuild` to `dependencies` matching the version already pinned in `packages/core/package.json` (`"esbuild": "^0.28.0"`). Place it in alphabetical order within the `dependencies` block.

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: completes; `node_modules/.pnpm/esbuild@0.28.0` resolvable from `packages/cli`.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/package.json pnpm-lock.yaml
git commit -m "build(cli): add esbuild dependency for workflow bundling"
```

---

## Task 2: `bundleWorkflow` — passthrough when there are no local imports

This is the fast path that keeps every existing single-file workflow byte-identical.

**Files:**
- Create: `packages/cli/src/bundle.ts`
- Test: `packages/cli/src/bundle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/src/bundle.test.ts
import { describe, it, expect } from "vitest";
import { bundleWorkflow } from "./bundle.js";

describe("bundleWorkflow", () => {
  it("returns the source unchanged when there are no local imports", async () => {
    const source = `import { defineWorkflow, agent } from "defineworkflow";\nexport default defineWorkflow({ name: "x", description: "d", harness: "claude", async run() { return await agent("hi"); } });\n`;
    const result = await bundleWorkflow({ path: "/does/not/matter.ts", source });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(source);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/cli/src/bundle.test.ts`
Expected: FAIL — cannot find module `./bundle.js`.

- [ ] **Step 3: Implement the passthrough**

```ts
// packages/cli/src/bundle.ts
import { ok, err, type Result } from "neverthrow";

export interface BundleInput {
  /** Absolute or cwd-relative path to the entry workflow file (esbuild resolves imports from here). */
  readonly path: string;
  /** The entry file's source, already read by the caller. */
  readonly source: string;
}

/** Matches a relative import: `... from "./x"` or `... from "../x"`. */
const RELATIVE_IMPORT = /^\s*import\b[^'"]*from\s*["']\.\.?\//m;

/**
 * Inline a workflow entry's LOCAL relative imports into one self-contained source string.
 * Workflows with no local imports are returned unchanged (no esbuild work) so existing
 * single-file workflows behave byte-identically. Returns the bundled (or original) source.
 */
export async function bundleWorkflow(input: BundleInput): Promise<Result<string, string>> {
  if (!RELATIVE_IMPORT.test(input.source)) return ok(input.source);
  return err("not implemented"); // real bundling added in Task 3
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/cli/src/bundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/bundle.ts packages/cli/src/bundle.test.ts
git commit -m "feat(cli): bundleWorkflow passthrough for single-file workflows"
```

---

## Task 3: `bundleWorkflow` — inline local imports with esbuild

**Files:**
- Modify: `packages/cli/src/bundle.ts`
- Test: `packages/cli/src/bundle.test.ts`

- [ ] **Step 1: Write the failing test**

Uses real temp files because esbuild resolves imports from disk.

```ts
// add to packages/cli/src/bundle.test.ts
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fixture(files: Record<string, string>): { dir: string; entry: string } {
  const dir = mkdtempSync(join(tmpdir(), "wf-bundle-"));
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return { dir, entry: join(dir, "entry.workflow.ts") };
}

it("inlines a local schema import and keeps defineworkflow external", async () => {
  const { dir, entry } = fixture({
    "schemas.ts": `import { z } from "defineworkflow";\nexport const ResearchSchema = z.object({ summary: z.string() });\n`,
    "entry.workflow.ts": `import { agent, defineWorkflow } from "defineworkflow";\nimport { ResearchSchema } from "./schemas";\nexport default defineWorkflow({ name: "spike", description: "d", harness: "claude", async run() { return await agent("hi", { schema: ResearchSchema }); } });\n`,
  });
  try {
    const result = await bundleWorkflow({ path: entry, source: "import { x } from \"./schemas\";" });
    expect(result.isOk()).toBe(true);
    const code = result._unsafeUnwrap();
    expect(code).toContain("z.object({ summary: z.string() })"); // helper inlined
    expect(code).toContain("export {"); // esbuild default re-export shape
    expect(code).toContain("as default"); // captured by sandbox later
    expect(code).toContain('from "defineworkflow"'); // kept external (not inlined)
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Note: the `source` field passed to `bundleWorkflow` only needs to contain a relative import so the passthrough guard doesn't short-circuit; esbuild reads the real file at `path`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/cli/src/bundle.test.ts -t "inlines a local schema"`
Expected: FAIL — returns `err("not implemented")`.

- [ ] **Step 3: Implement esbuild bundling**

Replace the `return err("not implemented")` line and add the imports/plugin:

```ts
// top of packages/cli/src/bundle.ts
import { build, type Plugin } from "esbuild";
import { ok, err, type Result } from "neverthrow";

// Forbid any import that is not a relative local file or the authoring package.
const localOnly: Plugin = {
  name: "workflow-local-only",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (a.kind === "entry-point") return null;
      if (a.path === "defineworkflow" || a.path === "workflow") return { path: a.path, external: true };
      if (a.path.startsWith("./") || a.path.startsWith("../")) return null; // esbuild resolves from disk
      return { errors: [{ text: `a workflow may only import local files or "defineworkflow"; "${a.path}" is not allowed` }] };
    });
  },
};
```

```ts
// replace the `return err("not implemented");` body tail
  try {
    const result = await build({
      entryPoints: [input.path],
      bundle: true,
      format: "esm",
      platform: "neutral",
      write: false,
      logLevel: "silent",
      plugins: [localOnly],
    });
    const out = result.outputFiles[0];
    if (!out) return err(`bundling produced no output for ${input.path}`);
    return ok(out.text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to bundle ${input.path}: ${message}`);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/cli/src/bundle.test.ts -t "inlines a local schema"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/bundle.ts packages/cli/src/bundle.test.ts
git commit -m "feat(cli): bundle local workflow imports with esbuild"
```

---

## Task 4: `bundleWorkflow` — reject non-local (npm) imports

**Files:**
- Test: `packages/cli/src/bundle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to packages/cli/src/bundle.test.ts
it("rejects an npm import with a clear error", async () => {
  const { dir, entry } = fixture({
    "entry.workflow.ts": `import { defineWorkflow } from "defineworkflow";\nimport _ from "lodash";\nexport default defineWorkflow({ name: "x", description: "d", harness: "claude", async run() { return _; } });\n`,
  });
  try {
    const result = await bundleWorkflow({ path: entry, source: `import x from "./missing";` });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/only import local files or "defineworkflow"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run it to verify it passes (behavior already implemented in Task 3)**

Run: `pnpm vitest run packages/cli/src/bundle.test.ts -t "rejects an npm import"`
Expected: PASS — the `localOnly` plugin raises the error, esbuild fails the build, and `bundleWorkflow` returns `err(...)` whose message includes the plugin text.

If it fails because the error string is wrapped, relax the assertion to `.toMatch(/lodash|local files/)` — the plugin's message is included in esbuild's aggregated build error.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/bundle.test.ts
git commit -m "test(cli): bundleWorkflow rejects npm imports"
```

---

## Task 5: Teach `transformScript` the bundled default-export shape

**Files:**
- Modify: `packages/core/src/sandbox.ts`
- Test: `packages/core/src/sandbox.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to the `describe("sandbox", ...)` block in packages/core/src/sandbox.test.ts
it("runs a bundled workflow (esbuild default-export shape)", async () => {
  // Mirrors esbuild's ESM bundle output: helper var first, defineWorkflow not first,
  // `export { X as default }` instead of `export default`.
  const src = [
    `import { agent, defineWorkflow } from "defineworkflow";`,
    `import { z } from "defineworkflow";`,
    `var ResearchSchema = z.object({ summary: z.string() });`,
    `var entry_workflow_default = defineWorkflow({`,
    `  name: "bundled", description: "d", harness: "claude", phases: [{ title: "Run" }],`,
    `  async run() { const out = await agent("hi", { schema: ResearchSchema }); return { out }; }`,
    `});`,
    `export {`,
    `  entry_workflow_default as default`,
    `};`,
  ].join("\n");
  const result = await runInSandbox(src, {
    defineWorkflow: (workflow: unknown) => workflow,
    z: { object: (x: unknown) => x, string: () => ({}) },
    agent: async () => "hit",
    parallel: async () => [],
    pipeline: async () => [],
    workflow: async () => null,
    phase: () => {},
    log: () => {},
    askUserQuestion: async () => "",
    args: null,
    budget: { total: null, spent: () => 0, remaining: () => Infinity, record: () => {} },
  });
  expect(result.meta).toMatchObject({ name: "bundled", harness: "claude", phases: [{ title: "Run" }] });
  expect(result.returnValue).toEqual({ out: "hit" });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/sandbox.test.ts -t "runs a bundled workflow"`
Expected: FAIL — `transformScript` throws "must export `const meta` or `export default defineWorkflow`" (the bundled shape has neither).

- [ ] **Step 3: Add the bundled-default branch to `transformScript`**

In `packages/core/src/sandbox.ts`, inside `transformScript`, immediately after `const authoringSource = stripWorkflowImports(source);` and BEFORE the existing `if (!/export\s+const\s+meta...)` guard, insert:

```ts
  // esbuild-bundled entry: `export default defineWorkflow(...)` was hoisted to
  // `var <name> = defineWorkflow({...})` + `export { <name> as default }`. Capture the
  // default-export local and invoke its run() with the injected runtime, mirroring the
  // single-file defineWorkflow branch below.
  const bundledDefault = /export\s*\{\s*([A-Za-z0-9_$]+)\s+as\s+default\s*\}\s*;?/.exec(authoringSource);
  if (bundledDefault) {
    const name = bundledDefault[1];
    const body = authoringSource.replace(bundledDefault[0], "");
    const wrapped = `(async () => {\n${body}\nreturn await ${name}.run({ agent, parallel, pipeline, workflow, phase, log, askUserQuestion, args, budget });\n})()`;
    return transformSync(wrapped, { loader: "ts", format: "esm" }).code;
  }
```

- [ ] **Step 4: Run the test (it will get further, then fail in `extractMeta`)**

Run: `pnpm vitest run packages/core/src/sandbox.test.ts -t "runs a bundled workflow"`
Expected: FAIL — now `runInSandbox` calls `extractMeta`, which throws because `defineWorkflow` is not the first statement. Task 6 fixes this. (If you prefer green-per-task, temporarily assert only on `transformScript` output here, then switch to the full `runInSandbox` assertion after Task 6. Recommended: keep this test as-is and complete Task 6 before committing.)

- [ ] **Step 5: Commit the transform change**

```bash
git add packages/core/src/sandbox.ts
git commit -m "feat(core): transformScript handles esbuild bundled default export"
```

---

## Task 6: Teach `extractMeta` to find `defineWorkflow` in bundled output

**Files:**
- Modify: `packages/core/src/sandbox.ts`
- Test: `packages/core/src/sandbox.test.ts`

This is additive: the strict "first statement" path is tried first (preserving every existing test, including "rejects meta that is not the first statement", which uses the legacy `export const meta` form with no `defineWorkflow` call). Only when no meta/`__workflow` is found as the first statement do we scan for a single `defineWorkflow(...)` call.

- [ ] **Step 1: Write the failing test**

```ts
// add to the `describe("extractMeta", ...)` block in packages/core/src/sandbox.test.ts
it("reads meta from esbuild bundled output (defineWorkflow not first)", () => {
  const src = [
    `import { agent, defineWorkflow } from "defineworkflow";`,
    `import { z } from "defineworkflow";`,
    `var S = z.object({ a: z.string() });`,
    `var entry_workflow_default = defineWorkflow({ name: "bundled", description: "d", harness: "claude" });`,
    `export { entry_workflow_default as default };`,
  ].join("\n");
  expect(extractMeta(src)).toMatchObject({ name: "bundled", description: "d", harness: "claude" });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/core/src/sandbox.test.ts -t "reads meta from esbuild bundled"`
Expected: FAIL — throws "metadata must be the first statement" (first statement is `var S = ...`).

- [ ] **Step 3: Restructure `locateMetaLiteral` to add a bundled fallback**

Replace the body of `locateMetaLiteral` (sandbox.ts:133-166) with the version below. It keeps the strict first-statement path, then falls back to scanning for a single `defineWorkflow(...)` call before throwing.

```ts
function locateMetaLiteral(program: AstNode): LocatedMeta {
  const top = asNodeArray(program.body)[0];
  const call = top?.type === "ExpressionStatement" ? childNode(top, "expression") : undefined;
  const arrow = call?.type === "CallExpression" ? childNode(call, "callee") : undefined;
  const block = arrow?.type === "ArrowFunctionExpression" ? childNode(arrow, "body") : undefined;
  const stmts = block ? asNodeArray(block.body) : [];

  // Skip a leading "use strict" directive esbuild may emit.
  const first = stmts.find(
    (s) => !(s?.type === "ExpressionStatement" && childNode(s, "expression")?.type === "Literal"),
  );

  // Strict path: meta / defineWorkflow declared as the FIRST statement (hand-written single file).
  if (first?.type === "VariableDeclaration" && first.kind === "const") {
    const decl = asNodeArray(first.declarations)[0];
    const id = decl ? childNode(decl, "id") : undefined;
    if (decl && id?.type === "Identifier") {
      let init = childNode(decl, "init");
      while (init?.type === "AssignmentExpression") init = childNode(init, "right");
      if (init) {
        if (id.name === "meta") return { node: init, mode: "meta" };
        if (id.name === "__workflow") return { node: defineWorkflowArg(init), mode: "defineWorkflow" };
      }
    }
  }

  // Bundled path: esbuild hoists helper declarations above `var <name> = defineWorkflow({...})`.
  // Scan top-level declarations for the (single) defineWorkflow call.
  const bundled = findBundledDefineWorkflow(stmts);
  if (bundled) return { node: bundled, mode: "defineWorkflow" };

  throw new Error("SandboxViolation: workflow metadata must be the first statement in the workflow");
}

/** Validate `init` is a `defineWorkflow(<objectLiteral>)` call and return its first argument node. */
function defineWorkflowArg(init: AstNode): AstNode {
  if (init.type !== "CallExpression") throw violation("defineWorkflow metadata must be a call");
  const callee = childNode(init, "callee");
  if (callee?.type !== "Identifier" || callee.name !== "defineWorkflow") {
    throw violation("default workflow export must call defineWorkflow");
  }
  const firstArg = asNodeArray(init.arguments)[0];
  if (!firstArg) throw violation("defineWorkflow requires a metadata object");
  return firstArg;
}

/** Find a top-level `var/const/let <name> = defineWorkflow({...})` declaration (esbuild bundle). */
function findBundledDefineWorkflow(stmts: Array<AstNode | undefined>): AstNode | undefined {
  for (const stmt of stmts) {
    if (stmt?.type !== "VariableDeclaration") continue;
    for (const decl of asNodeArray(stmt.declarations)) {
      if (!decl) continue;
      let init = childNode(decl, "init");
      while (init?.type === "AssignmentExpression") init = childNode(init, "right");
      if (init?.type !== "CallExpression") continue;
      const callee = childNode(init, "callee");
      if (callee?.type === "Identifier" && callee.name === "defineWorkflow") {
        return defineWorkflowArg(init);
      }
    }
  }
  return undefined;
}
```

Note: this reuses the existing `evaluateWorkflowDefinitionLiteral` (called by `extractMeta` for `mode: "defineWorkflow"`), which already skips the `run` method and rejects non-literal meta fields. The old inline `__workflow` handling is now centralized in `defineWorkflowArg`.

- [ ] **Step 4: Run the new test AND the full sandbox suite**

Run: `pnpm vitest run packages/core/src/sandbox.test.ts`
Expected: PASS — including the new bundled tests, "runs a bundled workflow" (Task 5), and every pre-existing test (notably "rejects meta that is not the first statement" and "runs a workflow exported with defineWorkflow()").

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sandbox.ts packages/core/src/sandbox.test.ts
git commit -m "feat(core): extractMeta reads meta from bundled defineWorkflow output"
```

---

## Task 7: Wire bundling into the run command

**Files:**
- Modify: `packages/cli/src/commands/run.ts`
- Test: `packages/cli/src/commands/run.test.ts` (create if it does not exist)

- [ ] **Step 1: Write the failing test**

First check for an existing run-command test: `ls packages/cli/src/commands/run.test.ts`. If present, add the case below; otherwise create the file using `fakeDeps` from `packages/cli/src/test-support.ts` (see its `fakeDeps`/`memFs` exports). The test runs a two-file workflow in `--mock` mode (no agents, no consent) and asserts it completes and that the registry snapshot is the bundled (self-contained) source.

```ts
// packages/cli/src/commands/run.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./run.js";
import { fakeDeps } from "../test-support.js";

describe("runCommand multi-file", () => {
  it("bundles local imports and snapshots the self-contained source", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-run-"));
    writeFileSync(join(dir, "schemas.ts"),
      `import { z } from "defineworkflow";\nexport const S = z.object({ summary: z.string() });\n`);
    const entry = join(dir, "wf.workflow.ts");
    writeFileSync(entry,
      `import { agent, defineWorkflow } from "defineworkflow";\nimport { S } from "./schemas";\n` +
      `export default defineWorkflow({ name: "mf", description: "d", harness: "claude", async run() { return await agent("hi", { schema: S }); } });\n`);

    const snapshots: Record<string, string> = {};
    const deps = fakeDeps({
      io: { readText: (p: string) => (p === entry ? readReal(entry) : p.endsWith("schemas.ts") ? readReal(join(dir, "schemas.ts")) : undefined) },
      registry: { init: (m: { runId: string }, src: string) => { snapshots[m.runId] = src; } },
    });

    const code = await runCommand({ script: entry, detach: false, yes: true, mock: true }, deps);
    expect(code).toBe(0);
    const snapshot = Object.values(snapshots)[0] ?? "";
    expect(snapshot).toContain("z.object({ summary: z.string() })"); // helper was inlined
    expect(snapshot).not.toMatch(/from\s*["']\.\//); // no relative imports remain
  });
});

function readReal(p: string): string {
  // eslint-disable-next-line no-sync — test helper
  return require("node:fs").readFileSync(p, "utf8");
}
```

Adapt the `fakeDeps` override shape to the actual `fakeDeps` signature (it is capability-grouped — `io`, `registry`, etc. are overridden shallowly). If `fakeDeps`'s default `registry.init` already records snapshots, assert against that instead of the inline capture.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/cli/src/commands/run.test.ts`
Expected: FAIL — the snapshot still contains `from "./schemas"` (no bundling yet), or `loadMeta` throws on the unstripped relative import.

- [ ] **Step 3: Insert the bundle step in `run.ts`**

In `packages/cli/src/commands/run.ts`, replace the source read at the top of `runCommand` (lines 25-29):

```ts
  const raw = deps.io.readText(args.script);
  if (raw === undefined) {
    deps.ui.print(`error: cannot read script ${args.script}\n`);
    return 1;
  }
  const bundled = await bundleWorkflow({ path: args.script, source: raw });
  if (bundled.isErr()) {
    deps.ui.print(`error: ${bundled.error}\n`);
    return 1;
  }
  const source = bundled.value;
```

Add the import at the top of the file:

```ts
import { bundleWorkflow } from "../bundle.js";
```

Everything downstream (`loadMeta(source)`, `decideConsent`, `promptConsent(meta, source, …)`, `deps.clock.hash(source)`, `deps.registry.init(meta0, source)`, `runForeground({ source, … })`) is unchanged — it now receives the bundle.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/cli/src/commands/run.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the broader CLI suite to catch regressions**

Run: `pnpm vitest run packages/cli`
Expected: PASS — existing single-file run tests are unaffected (no local imports → passthrough).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/run.ts packages/cli/src/commands/run.test.ts
git commit -m "feat(cli): bundle multi-file workflows in the run command"
```

---

## Task 8: Confirm save/resume persist the bundle (test-only)

`saveRun` (`packages/cli/src/execute.ts:224`) writes `registry.readScript(runId)` — the snapshot — and `resume` re-hashes that snapshot against `meta.scriptHash`. Since Task 7 snapshots the bundle and hashes the bundle, both already work. Lock it with a regression test.

**Files:**
- Modify: `packages/cli/src/execute.test.ts` (or wherever `saveRun` is tested; otherwise add to `run.test.ts`)

- [ ] **Step 1: Write the test**

```ts
it("save writes the self-contained bundle (no relative imports)", () => {
  // Arrange a registry whose snapshot is a bundled source (helpers inlined, no `./` imports).
  const bundled = `var S = ({});\nvar wf = defineWorkflow({ name: "mf", description: "d", harness: "claude" });\nexport { wf as default };`;
  const deps = fakeDeps({
    registry: { readMeta: () => ({ name: "mf" }), readScript: () => bundled },
  });
  const path = saveRun(deps, "run-1");
  expect(path).toMatch(/\/workflows\/mf\.ts$/);
  // The bytes written are the bundle verbatim — assert via the fake io capture.
});
```

Adapt to the real `saveRun`/`fakeDeps` shapes (capture the `io.writeText` call to assert the written bytes equal `bundled`).

- [ ] **Step 2: Run it to verify it passes**

Run: `pnpm vitest run packages/cli/src/execute.test.ts -t "self-contained bundle"`
Expected: PASS (no production code change — this documents the guarantee).

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/execute.test.ts
git commit -m "test(cli): save persists the self-contained workflow bundle"
```

---

## Task 9: Dogfood example — a multi-file workflow

**Files:**
- Create: `packages/examples/src/multi-file-haiku/haiku.workflow.ts`
- Create: `packages/examples/src/multi-file-haiku/schemas.ts`
- Create: `packages/examples/src/multi-file-haiku/prompts.ts`

- [ ] **Step 1: Create the schema file**

```ts
// packages/examples/src/multi-file-haiku/schemas.ts
import { z } from "defineworkflow";

export const HaikuSchema = z.object({
  haiku: z.string().describe("a three-line haiku"),
  syllables: z.array(z.number()).describe("syllable count per line, e.g. [5,7,5]"),
});
```

- [ ] **Step 2: Create the prompts file**

```ts
// packages/examples/src/multi-file-haiku/prompts.ts
export function haikuPrompt(topic: string): string {
  return `Write a single haiku about "${topic}". Return the haiku and the syllable count of each line.`;
}
```

- [ ] **Step 3: Create the slim entry**

```ts
// packages/examples/src/multi-file-haiku/haiku.workflow.ts
import { agent, args, defineWorkflow, log } from "defineworkflow";
import { HaikuSchema } from "./schemas";
import { haikuPrompt } from "./prompts";

export default defineWorkflow({
  name: "multi-file-haiku",
  description: "A minimal multi-file workflow: schema + prompt live in sibling files; the entry reads like a table of contents.",
  harness: "claude",
  phases: [{ title: "Write", detail: "one agent writes a haiku" }],
  async run() {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the immutable CLI args payload
    const topic = ((args ?? {}) as { topic?: string }).topic ?? "a deterministic workflow engine";
    log(`writing a haiku about: ${topic}`);
    const result = await agent(haikuPrompt(topic), { label: "haiku", phase: "Write", schema: HaikuSchema });
    return result;
  },
});
```

- [ ] **Step 4: Verify it bundles and runs in mock mode (no tokens)**

Run: `pnpm build && node packages/cli/dist/cli.js run packages/examples/src/multi-file-haiku/haiku.workflow.ts --mock`
Expected: the workflow runs to completion in `--mock` mode, prints a schema-valid fabricated result object, and spends no tokens. (This proves bundling → meta → sandbox end-to-end through the real CLI.)

- [ ] **Step 5: Commit**

```bash
git add packages/examples/src/multi-file-haiku
git commit -m "docs(examples): multi-file workflow example"
```

---

## Task 10: Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the multi-file authoring model**

In `CLAUDE.md`, under the `packages/workflow` section (the authoring entrypoint), add a short subsection describing:
- A workflow may be a single file or a folder: a slim **entry file** exporting `defineWorkflow({...})` plus local helper files (schemas, prompts) imported with relative paths.
- Imports are restricted to **local files + `"defineworkflow"`**; npm imports are rejected at bundle time (keeps the sandbox deterministic by construction).
- The CLI bundles the entry's local imports into one self-contained source string before the sandbox runs; that bundle is what gets snapshotted, so `save`/`resume`/`--detach` are self-contained.
- `meta` still lives in the entry's `defineWorkflow({...})` call as a pure literal. Schemas may now live at a helper file's top level (`export const X = z.object({...})`) — they no longer have to be declared inside `run()`.
- Known limitation: a **nested** `workflow("name")` target must be either single-file or a saved (already-bundled) workflow; a hand-placed multi-file nested workflow is not bundled by the nested resolver.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document multi-file workflow authoring"
```

- [ ] **Step 3: Compound the learning**

After the full suite is green, invoke the `superpowers:compound` skill to add a `docs/solutions/` entry capturing: esbuild bundled default-export shape (`export { X as default }`), the additive `extractMeta` fallback, and the local-only resolve plugin.

---

## Final verification

- [ ] **Full build + typecheck + lint + tests**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: all green.

- [ ] **Knip (unused code/deps)**

Run: `pnpm knip`
Expected: no new findings (esbuild is now genuinely used by `@workflow/cli`). Consult `docs/solutions/developer-experience/knip-false-positives-in-this-monorepo.md` before acting on any finding.

- [ ] **End-to-end mock run** (repeat of Task 9 Step 4) to confirm the real CLI path.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- "schema in one file + helper files, slim main" → Tasks 2-9 (bundling + example).
- "local files only" → Task 3/4 (`localOnly` plugin).
- "entry-file + relative imports" convention → Tasks 7, 9.
- "save persists the bundle" → falls out of Task 7's snapshot; locked by Task 8.
- esbuild output-shape risk (spec's flagged spike) → resolved empirically; Tasks 5-6 handle the `export { X as default }` + non-first `defineWorkflow` shapes.
- Determinism preserved → local-only imports + unchanged sandbox bans; noted in Tasks 3 and 10.

**Placeholder scan:** No "TBD"/"implement later". The one deliberate stub (`err("not implemented")` in Task 2) is replaced in Task 3 with a failing-test driver around it.

**Type consistency:** `bundleWorkflow({ path, source }) → Result<string,string>` used identically in Task 7. `defineWorkflowArg`/`findBundledDefineWorkflow` reuse existing `evaluateWorkflowDefinitionLiteral` via `mode: "defineWorkflow"`. The bundled-default identifier is captured, never hardcoded.

**Note for the implementer:** `fakeDeps` override shapes in Tasks 7-8 are illustrative — confirm the exact capability-grouped signature in `packages/cli/src/test-support.ts` and adjust the overrides/captures to match (the CLAUDE.md "Test layout & conventions" section documents it).
