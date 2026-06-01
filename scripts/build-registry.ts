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
  const version: unknown = JSON.parse(readFileSync(join(root, "recipe.json"), "utf8")).version;
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
