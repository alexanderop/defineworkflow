import { build } from "esbuild";
import type { Plugin } from "esbuild";
import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import { dirname } from "node:path";

export interface BundleInput {
  /** Used only to resolve the entry's relative imports (esbuild's `resolveDir`/`sourcefile`). */
  readonly path: string;
  /** The entry file's source — the single source of truth that is bundled. */
  readonly source: string;
}

/**
 * Matches a relative import: `... from "./x"` or `... from "../x"`.
 * Side-effect imports (`import "./x"` with no `from`) are intentionally not matched by this
 * passthrough pre-check (they're rare in workflows; if present, esbuild's plugin still handles
 * them once bundling is triggered by another import).
 */
const RELATIVE_IMPORT = /^\s*import\b[^'"]*from\s*["']\.\.?\//m;

// Forbid any import that is not a relative local file or the authoring package.
const localOnly: Plugin = {
  name: "workflow-local-only",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "entry-point") return null;
      if (args.path === "defineworkflow" || args.path === "workflow")
        return { path: args.path, external: true };
      if (args.path.startsWith("./") || args.path.startsWith("../")) return null; // esbuild resolves from disk
      return {
        errors: [
          {
            text: `a workflow may only import local files or "defineworkflow"; "${args.path}" is not allowed`,
          },
        ],
      };
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
      stdin: {
        contents: input.source,
        resolveDir: dirname(input.path),
        sourcefile: input.path,
        loader: "ts",
      },
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
