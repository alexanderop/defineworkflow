# transformScript comment/replace desync fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use references/subagent-driven-development/SKILL.md (recommended) or references/executing-plans/SKILL.md to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `transformScript` (and `extractMeta`/`runInSandbox`) locate the _real_ `export default defineWorkflow(` / `export const meta` / `export default` statement, ignoring identical text that appears inside comments or string literals, so detect and replace operate on the same match.

**Architecture:** The transform rewrites workflow source via regex _before_ esbuild strips TS, so we can't parse with acorn (it isn't JS yet). Instead, add a `maskNonCode(source)` scanner that returns a same-length copy of the source with the _contents_ of comments and string/template literals blanked to spaces (delimiters & newlines preserved). Run the detection/location regexes against the **masked** copy to get match offsets, then splice the replacement into the **original** at those offsets via a `replaceFirstReal` helper. This guarantees detect and replace use the same (real) match and that comment/string text can never be mistaken for the export.

**Tech Stack:** TypeScript (ESM, strict), esbuild `transformSync`, acorn (downstream of the transform only), vitest.

---

### Task 1: Mask non-code regions and rewrite against the same match

**Files:**

- Modify: `packages/core/src/sandbox.ts` (`transformScript` lines ~41-64; add `maskNonCode` + `replaceFirstReal` helpers)
- Test: `packages/core/src/sandbox.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/sandbox.test.ts` inside the `describe("sandbox", …)` block:

```ts
it("ignores a defineWorkflow export named inside a JSDoc comment", async () => {
  const src = `import { defineWorkflow } from "defineworkflow";

/**
 * NOTE: the engine requires \`export default defineWorkflow(...)\` to be first.
 */
export default defineWorkflow({
  name: "commented",
  description: "has a comment mentioning the export",
  harness: "claude",
  phases: [{ title: "Run" }],
  async run() {
    return { ok: true };
  },
});`;
  const result = await runInSandbox(src, {
    defineWorkflow: (workflow: unknown) => workflow,
    agent: async () => "",
    parallel: async () => [],
    pipeline: async () => [],
    workflow: async () => null,
    phase: () => {},
    log: () => {},
    askUserQuestion: async () => "",
    args: null,
    budget: { total: null, spent: () => 0, remaining: () => Infinity, record: () => {} },
  });
  expect(result.meta).toMatchObject({ name: "commented", harness: "claude" });
  expect(result.returnValue).toEqual({ ok: true });
});

it("ignores a meta export mentioned in a comment and a string literal", async () => {
  const src = `// to use this, write: export const meta = { … }
const hint = "export const meta = { fake: true }";
export const meta = { name: "real", description: "d", harness: "claude", phases: [] };
return hint.length;`;
  const result = await runInSandbox(src, {});
  expect(result.meta.name).toBe("real");
  expect(typeof result.returnValue).toBe("number");
});
```

Add to the `describe("extractMeta", …)` block:

```ts
it("reads the real meta when a comment mentions a different export form", () => {
  const src = `/** example: export default defineWorkflow({ name: "fake" }) */
export const meta = { name: "true-meta", description: "d", harness: "claude", phases: [] };
export default {};`;
  expect(extractMeta(src).name).toBe("true-meta");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/sandbox.test.ts -t "comment"` and `-t "JSDoc"`
Expected: FAIL — the JSDoc case throws an esbuild `Unexpected "export"` (or branch mis-selection), proving the desync.

- [ ] **Step 3: Implement `maskNonCode` + `replaceFirstReal` and rewire `transformScript`**

Add these helpers near `transformScript` in `packages/core/src/sandbox.ts`:

```ts
/**
 * Return a same-length copy of `source` with the *contents* of comments and string/template
 * literals blanked to spaces (delimiters and newlines preserved). Detection/location regexes run
 * against this masked copy so text like `export default defineWorkflow(` inside a JSDoc comment or
 * a string can't be mistaken for the real export, while match offsets still line up with the
 * original source for splicing.
 */
function maskNonCode(source: string): string {
  const chars = source.split("");
  const n = chars.length;
  const blank = (idx: number): void => {
    const ch = chars[idx];
    if (ch !== "\n" && ch !== "\r") chars[idx] = " ";
  };
  type State = "code" | "line" | "block" | "single" | "double" | "template";
  let state: State = "code";
  let i = 0;
  while (i < n) {
    const c = source[i];
    const next = i + 1 < n ? source[i + 1] : "";
    if (state === "code") {
      if (c === "/" && next === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (c === "'") {
        state = "single";
        i += 1;
        continue;
      }
      if (c === '"') {
        state = "double";
        i += 1;
        continue;
      }
      if (c === "`") {
        state = "template";
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        state = "code";
        i += 1;
        continue;
      }
      blank(i);
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c === "*" && next === "/") {
        blank(i);
        blank(i + 1);
        state = "code";
        i += 2;
        continue;
      }
      blank(i);
      i += 1;
      continue;
    }
    // string / template literal
    if (c === "\\") {
      blank(i);
      blank(i + 1);
      i += 2;
      continue;
    }
    if (
      (state === "single" && c === "'") ||
      (state === "double" && c === '"') ||
      (state === "template" && c === "`")
    ) {
      state = "code";
      i += 1;
      continue;
    }
    if ((state === "single" || state === "double") && c === "\n") {
      state = "code";
      i += 1;
      continue;
    }
    blank(i);
    i += 1;
  }
  return chars.join("");
}

/**
 * Replace the first occurrence of `pattern` that appears in `masked` (the comment/string-blanked
 * twin of `source`) by splicing `replacement` into `source` at the same offset. Detect and replace
 * therefore act on the *same* real match; returns `source` unchanged when there is no real match.
 */
function replaceFirstReal(
  source: string,
  masked: string,
  pattern: RegExp,
  replacement: string,
): string {
  const m = pattern.exec(masked);
  if (!m) return source;
  return source.slice(0, m.index) + replacement + source.slice(m.index + m[0].length);
}
```

Rewrite the body of `transformScript` (keep the import-strip/foreign-import guard) so detection and replacement run through the mask:

```ts
export function transformScript(source: string): string {
  const authoringSource = stripWorkflowImports(source);
  assertNoForeignImports(authoringSource);
  const masked = maskNonCode(authoringSource);
  const hasMeta = /export\s+const\s+meta\s*=/.test(masked);
  const hasDefineWorkflow = /\bexport\s+default\s+defineWorkflow\s*\(/.test(masked);
  if (!hasMeta && !hasDefineWorkflow) {
    throw new Error(
      "SandboxViolation: workflow script must export `const meta` or `export default defineWorkflow({ … })`",
    );
  }
  if (hasDefineWorkflow) {
    const safe = replaceFirstReal(
      authoringSource,
      masked,
      /\bexport\s+default\s+defineWorkflow\s*\(/,
      "const __workflow = globalThis.__workflow = defineWorkflow(",
    );
    const wrapped = `(async () => {\n${safe}\nreturn await __workflow.run({ agent, parallel, pipeline, workflow, phase, log, askUserQuestion, args, budget });\n})()`;
    return transformSync(wrapped, { loader: "ts", format: "esm" }).code;
  }
  // Declare `const meta` (so the script body can reference it) AND mirror the same
  // value onto a global for extraction — without needing to locate the end of the
  // meta literal. Robust to multi-line literals, `as const`, semicolons inside
  // strings, and a missing trailing semicolon.
  const metaRenamed = replaceFirstReal(
    authoringSource,
    masked,
    /export\s+const\s+meta\s*=\s*/,
    "const meta = globalThis.__meta = ",
  );
  const safe = replaceFirstReal(
    metaRenamed,
    maskNonCode(metaRenamed),
    /\bexport\s+default\b/,
    "return",
  );
  const wrapped = `(async () => {\n${safe}\n})()`;
  return transformSync(wrapped, { loader: "ts", format: "esm" }).code;
}
```

Note: the `meta` path re-masks `metaRenamed` before locating `export default`, because the first splice shifts offsets.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core/src/sandbox.test.ts`
Expected: PASS (new tests + all existing sandbox tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sandbox.ts packages/core/src/sandbox.test.ts
git commit -m "fix(core): locate real workflow export past comments/strings in transformScript"
```

---

### Task 2: Full verification

- [ ] **Step 1:** `pnpm vitest run packages/core/src/sandbox.test.ts` — green.
- [ ] **Step 2:** `pnpm lint` and `pnpm typecheck` — clean.
- [ ] **Step 3:** `pnpm test` (unit project) — green.

---

## Self-Review

- **Spec coverage:** Both suggested fixes are covered — comments/strings are skipped via `maskNonCode`, and detect+replace share the same match via `replaceFirstReal`. The defineWorkflow JSDoc repro is a direct test.
- **Placeholder scan:** none.
- **Type consistency:** `maskNonCode(source: string): string`, `replaceFirstReal(source, masked, pattern, replacement): string` used consistently; `transformScript` signature unchanged.
