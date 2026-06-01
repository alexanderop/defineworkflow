// Copy + validate the bundled `init` templates at build time (runs as `prebuild`).
//
// The template SOURCE lives in the CLI package at `packages/cli/templates/` — co-located with the
// `node-deps.ts` that resolves `Env.templatesDir` and the `init`/`list-templates` commands that read
// them, so the `@workflow/cli` `workflow` bin finds them natively (`<cli>/dist/../templates`).
//
// The published `defineworkflow` package bundles the CLI into its own `dist/cli.js`, so that bin
// resolves `<workflow>/dist/../templates`. This script copies the source set into
// `packages/workflow/templates/` (listed in package.json `files`) so the published tarball ships
// them. The copy is regenerated every build; `packages/workflow/templates/` is git-ignored.
//
// While copying, it enforces the invariants `list-templates` relies on:
//   1. every manifest entry's file exists;
//   2. the file's declared `harness` literal matches the manifest's `harness`;
//   3. each template bundles cleanly under the same "local files + defineworkflow only" rule the
//      CLI enforces on a real `workflow run`, so "it scaffolded" implies "it bundles".
//
// Self-contained: depends only on esbuild (already a runtime dependency of this package), never on
// the built CLI `dist/`, so it is safe to run early in a topological build / in CI.

import { build } from "esbuild";
import { readFile, mkdir, rm, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const srcDir = fileURLToPath(new URL("../../cli/templates", import.meta.url));
const destDir = fileURLToPath(new URL("../templates", import.meta.url));

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
  const raw = await readFile(path.join(srcDir, "index.json"), "utf8");
  const index = JSON.parse(raw);
  if (index.version !== 1)
    throw new Error(`unexpected templates/index.json version ${index.version}`);

  for (const t of index.templates) {
    const dir = t.multiFile ? path.join(srcDir, t.dir ?? t.name) : srcDir;
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

  // Mirror the validated source set into the published package verbatim.
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  await cp(srcDir, destDir, { recursive: true });

  process.stdout.write(`templates: validated ${index.templates.length}, copied → ${destDir}\n`);
}

main().catch((e) => {
  process.stderr.write(`copy-templates: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
