// Validate the bundled `init` templates at build time (runs as `prebuild`).
//
// The 8 templates live under `packages/workflow/templates/` and ship in the published tarball
// (see package.json `files`). `templates/index.json` is the gallery manifest read by
// `workflow list-templates` / `workflow init`. This script keeps the two honest:
//
//   1. every manifest entry's file exists on disk;
//   2. the file's declared `harness` literal matches the manifest's `harness`
//      (the invariant `list-templates` relies on — it never reads the workflow files);
//   3. each template bundles cleanly under the same "local files + defineworkflow only" rule the
//      CLI enforces on a real `workflow run`, so "it scaffolded" implies "it bundles".
//
// Self-contained: depends only on esbuild (already a runtime dependency of this package), never on
// the built CLI `dist/`, so it is safe to run early in a topological build / in CI.

import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const templatesDir = fileURLToPath(new URL("../templates", import.meta.url));

/** Only relative files and "defineworkflow" may be imported — mirrors the CLI's bundle guard. */
const localOnly = {
  name: "workflow-local-only",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "entry-point") return null;
      if (args.path === "defineworkflow" || args.path === "workflow")
        return { path: args.path, external: true };
      if (args.path.startsWith("./") || args.path.startsWith("../")) return null;
      return { errors: [{ text: `template may not import "${args.path}"` }] };
    });
  },
};

const HARNESS_RE = /\bharness\s*:\s*["']([^"']+)["']/;

async function main() {
  const raw = await readFile(path.join(templatesDir, "index.json"), "utf8");
  const index = JSON.parse(raw);
  if (index.version !== 1)
    throw new Error(`unexpected templates/index.json version ${index.version}`);

  for (const t of index.templates) {
    const dir = t.multiFile ? path.join(templatesDir, t.dir ?? t.name) : templatesDir;
    const entryPath = path.join(dir, t.entry);
    const source = await readFile(entryPath, "utf8");

    const match = HARNESS_RE.exec(source);
    if (!match) throw new Error(`${t.name}: no harness literal found in ${t.entry}`);
    if (match[1] !== t.harness)
      throw new Error(
        `${t.name}: harness mismatch — file says "${match[1]}", index says "${t.harness}"`,
      );

    await build({
      stdin: { contents: source, resolveDir: dir, sourcefile: entryPath, loader: "ts" },
      bundle: true,
      format: "esm",
      platform: "neutral",
      write: false,
      logLevel: "silent",
      plugins: [localOnly],
    });
  }

  process.stdout.write(`templates: validated ${index.templates.length}, index.json OK\n`);
}

main().catch((e) => {
  process.stderr.write(`copy-templates: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
