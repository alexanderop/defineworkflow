---
title: "transformScript detect/replace desync: a defineWorkflow export named in a comment breaks the rewrite"
date: 2026-05-31
track: bug
category: integration-issues
problem_type: "sandbox_source_rewrite_desync"
module: "core"
component: "sandbox"
tags:
  ["sandbox", "transformScript", "esbuild", "comments", "regex", "export-default", "defineWorkflow"]
symptoms: 'Workflow fails with `Transform failed with 1 error: <stdin>:N:0: ERROR: Unexpected "export"` at a confusing line number'
root_cause: "transformScript detected the export with `.test()` (matches any occurrence, incl. inside a comment/string) but rewrote the first occurrence with a separate non-global `.replace()`; a comment mentioning the export got rewritten, leaving the real `export default` to reach esbuild"
resolution_type: "code-fix"
related:
  - "architecture-patterns/workflow-sandbox-script-constraints.md"
---

# transformScript detect/replace desync: an export named in a comment breaks the rewrite

## Problem

`packages/core/src/sandbox.ts`'s `transformScript` rewrites a workflow's top-level export into an
async IIFE _before_ handing the source to esbuild. It did this with two **independent** regex
operations:

- **Detect:** `/export\s+default\s+defineWorkflow\s*\(/.test(source)` — `.test()` matches _any_
  occurrence anywhere in the source, including inside a JSDoc comment or a string literal.
- **Rewrite:** `source.replace(/…/, "…")` — a non-global `.replace()` rewrites only the _first_
  occurrence.

When the literal text `export default defineWorkflow(...)` appeared in a comment **above** the real
export, the rewrite landed on the comment and left the real `export default` untouched. That real
`export` then reached esbuild wrapped inside the async IIFE (where a static `export` is illegal):

```
error: Transform failed with 1 error:
<stdin>:24:0: ERROR: Unexpected "export"
```

…pointing at a confusing post-transform line number, not the author's source. Reproduces with the
most natural thing an author writes — a doc comment describing the required form:

```ts
/**
 * NOTE: the engine requires `export default defineWorkflow(...)` to be first.
 */
export default defineWorkflow({
  /* ... */
});
```

The same desync also misclassified the branch: a comment mentioning `defineWorkflow` could send a
real `export const meta` script down the `defineWorkflow` path.

## Root Cause

Detect and replace operated on **different matches**. Detection saw the comment occurrence; the
rewrite (first occurrence) also hit the comment; nothing ever rewrote the real export. Because the
transform runs on raw TS _before_ esbuild strips comments, the comment text is still present and
indistinguishable from code to a naive regex.

## Resolution

Make detect and replace act on the **same real match**, and exclude comments/strings from matching:

- `maskNonCode(source)` returns a **same-length** copy of the source with the _contents_ of
  comments and string/template literals blanked to spaces (delimiters and newlines preserved).
  Offsets in the mask line up 1:1 with the original.
- `replaceFirstReal(source, masked, pattern, replacement)` runs `pattern.exec(masked)` to find the
  first **real** match, then splices `replacement` into the _original_ at `m.index`.
- `transformScript` runs detection (`hasMeta` / `hasDefineWorkflow`) and every rewrite (the
  `defineWorkflow` export, plus the legacy `export const meta` rename and `export default` →
  `return`) through the mask. The `meta` path re-masks after the first splice because the splice
  shifts offsets.

## Why an AST wasn't used

The rewrite must happen _before_ esbuild strips TS — the source isn't valid JS yet (TS types,
top-level `return`), so acorn (used later in `extractMeta`) can't parse it at this stage. A
character-state scanner that blanks comments/strings is the cheapest robust option that keeps the
existing IIFE-first ordering.

## Known Limitation

`maskNonCode` does **not** track regex literals (the regex-vs-division ambiguity needs a real
tokenizer). A top-level regex literal containing a quote char, placed _between_ `export const meta`
and the legacy `export default` return, can open a spurious string state. This does **not** affect
the `defineWorkflow` path (its export is the first real statement, found before any body code) or
any reported case. A fragile disambiguation heuristic would be worse than the documented limit.

## When to Apply

- Editing `transformScript` / the sandbox source-rewrite path, or adding new top-level rewrites.
- Any time you reach for `String.replace(regex, …)` on workflow source: a non-global `.replace()`
  rewrites the first match, which may be in a comment/string — route it through `replaceFirstReal`
  against a `maskNonCode` twin instead, and never let `.test()` decide a branch off raw source.

## Tests

`packages/core/src/sandbox.test.ts` — `runInSandbox` ignores a `defineWorkflow` export named in a
JSDoc comment (the exact repro) and one mentioned in a comment + string literal; `extractMeta` reads
the real meta when a comment mentions a different export form. All three fail with
`Unexpected "export"` before the fix.
