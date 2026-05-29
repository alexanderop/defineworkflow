export interface RunIdDeps {
  readonly now: () => number;
  readonly rand: () => number;
}

/** Lowercase, hyphenate, and strip anything that isn't a path-safe character. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "workflow" : slug;
}

/** A sortable, filesystem-safe run id: `<slug>-<base36 time>-<base36 rand>`. */
export function genRunId(name: string, deps: RunIdDeps): string {
  const time = Math.floor(deps.now()).toString(36);
  const rand = Math.floor(deps.rand() * 1_000_000).toString(36);
  return `${slugify(name)}-${time}-${rand}`;
}
