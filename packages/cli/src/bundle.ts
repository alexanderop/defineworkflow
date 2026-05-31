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
