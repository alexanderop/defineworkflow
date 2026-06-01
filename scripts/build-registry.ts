#!/usr/bin/env node
// Turn each recipes/<name>/ folder into a committed registry blob.
//   recipes/<name>/recipe.json  → { version }
//   recipes/<name>/**           → files: [{ path, content }]  (recipe.json excluded)
// Output: registry/r/<name>.json + registry/index.json. Run via `pnpm build:registry`.
//
// Self-contained except for the shared, unit-tested recipe helpers in the CLI package
// (`buildBlob`/`parseRecipeVersion`) — node resolves their `zod` import from the cli
// package's node_modules, so `node scripts/build-registry.ts` runs without a build step.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, relative, posix, sep } from "node:path";
import { buildBlob, parseRecipeVersion, type RegistryBlob } from "../packages/cli/src/recipes.ts";

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

function buildRecipe(name: string): RegistryBlob {
  const root = join(RECIPES, name);
  const version = parseRecipeVersion(readFileSync(join(root, "recipe.json"), "utf8"));
  if (version === undefined) {
    throw new Error(`recipes/${name}/recipe.json: missing or non-string "version"`);
  }
  const files = walk(root)
    .map((full) => ({ path: relative(root, full).split(sep).join(posix.sep), full }))
    .filter((f) => f.path !== "recipe.json")
    .map((f) => ({ path: f.path, content: readFileSync(f.full, "utf8") }));
  return buildBlob(name, version, files);
}

const names = readdirSync(RECIPES).filter((n) => statSync(join(RECIPES, n)).isDirectory());
mkdirSync(OUT_R, { recursive: true });
const index: { name: string; version: string }[] = [];
for (const name of names) {
  const blob = buildRecipe(name);
  writeFileSync(join(OUT_R, `${name}.json`), `${JSON.stringify(blob, null, 2)}\n`);
  index.push({ name: blob.name, version: blob.version });
}
const sortedIndex = index.toSorted((a, b) => (a.name < b.name ? -1 : 1));
writeFileSync(join(OUT_DIR, "index.json"), `${JSON.stringify(sortedIndex, null, 2)}\n`);
console.log(`built ${index.length} recipe(s): ${index.map((r) => r.name).join(", ")}`);
