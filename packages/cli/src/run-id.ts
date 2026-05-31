import type { RunId } from "@workflow/core";

export interface RunIdDeps {
  readonly now: () => number;
  readonly rand: () => number;
}

/** Lowercase, hyphenate, and strip anything that isn't a path-safe character. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    // The previous step collapses every run of non-alphanumerics to a single
    // "-", so a single-character trim suffices here. Trimming with `-+` instead
    // would backtrack polynomially on a long dash run (ReDoS).
    .replace(/^-|-$/g, "");
  return slug === "" ? "workflow" : slug;
}

/** A sortable, filesystem-safe run id: `<slug>-<base36 time>-<base36 rand>`. The sole `RunId` mint. */
export function genRunId(name: string, deps: RunIdDeps): RunId {
  const time = Math.floor(deps.now()).toString(36);
  const rand = Math.floor(deps.rand() * 1_000_000).toString(36);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- brand mint: the sole RunId construction point
  return `${slugify(name)}-${time}-${rand}` as RunId;
}
