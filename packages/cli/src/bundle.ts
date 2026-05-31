import { build } from "esbuild";
import type { Plugin } from "esbuild";
import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";

export interface BundleInput {
  /** Absolute or cwd-relative path to the entry workflow file (esbuild resolves imports from here). */
  readonly path: string;
  /** The entry file's source, already read by the caller. */
  readonly source: string;
}

/** Matches a relative import: `... from "./x"` or `... from "../x"`. */
const RELATIVE_IMPORT = /^\s*import\b[^'"]*from\s*["']\.\.?\//m;

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

/**
 * Inline a workflow entry's LOCAL relative imports into one self-contained source string.
 * Workflows with no local imports are returned unchanged (no esbuild work) so existing
 * single-file workflows behave byte-identically. Returns the bundled (or original) source.
 */
export async function bundleWorkflow(input: BundleInput): Promise<Result<string, string>> {
  if (!RELATIVE_IMPORT.test(input.source)) return ok(input.source);
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
}
