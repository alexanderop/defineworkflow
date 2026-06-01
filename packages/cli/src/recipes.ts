import { z } from "zod";
import crypto from "node:crypto";

/** Hardcoded for the POC (design §Future layering: swap for a config resolver later). */
export const REGISTRY_BASE =
  "https://raw.githubusercontent.com/alexanderop/defineworkflow/main/registry";

export const recipeUrl = (name: string): string => `${REGISTRY_BASE}/r/${name}.json`;

export const RegistryBlob = z.object({
  name: z.string(),
  version: z.string(),
  files: z.array(z.object({ path: z.string(), content: z.string() })),
});
export type RegistryBlob = z.infer<typeof RegistryBlob>;

export const LockEntry = z.object({
  version: z.string(),
  url: z.string(),
  hash: z.string(),
  ejectedAt: z.number(),
});
export type LockEntry = z.infer<typeof LockEntry>;

export const RecipesLock = z.record(z.string(), LockEntry);
export type RecipesLock = z.infer<typeof RecipesLock>;

export interface RecipeFileData {
  readonly path: string;
  readonly content: string;
}

const byPath = (a: RecipeFileData, b: RecipeFileData): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/** Canonical, order-independent sha256 of a recipe's file set. */
export function hashFiles(files: readonly RecipeFileData[]): string {
  const h = crypto.createHash("sha256");
  for (const f of [...files].sort(byPath)) h.update(`${f.path}\0${f.content}\0`);
  return `sha256-${h.digest("hex")}`;
}

/** Dotted-numeric semver compare: -1 if a<b, 0 if equal, 1 if a>b. Missing parts = 0. */
export function compareVersions(a: string, b: string): number {
  const toParts = (v: string): number[] =>
    v.split(".").map((n) => {
      const x = Number(n);
      return Number.isFinite(x) ? x : 0;
    });
  const pa = toParts(a);
  const pb = toParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** Reject absolute paths and `..` traversal — defense against a malicious blob. */
export function isSafeRelativePath(p: string): boolean {
  if (p.length === 0) return false;
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return false;
  const parts = p.split(/[\\/]/);
  return !parts.includes("..") && !parts.includes("");
}

/** Assemble a deterministic, sorted blob (used by the build script + tests). */
export function buildBlob(
  name: string,
  version: string,
  files: readonly RecipeFileData[],
): RegistryBlob {
  return {
    name,
    version,
    files: [...files].sort(byPath).map((f) => ({ path: f.path, content: f.content })),
  };
}

/** Read `version` from a recipe.json payload; undefined when missing/invalid. */
export function parseRecipeVersion(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  try {
    const r = z.object({ version: z.string() }).safeParse(JSON.parse(raw));
    return r.success ? r.data.version : undefined;
  } catch {
    return undefined;
  }
}
