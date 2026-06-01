export interface ResolveDeps {
  readonly homeDir: string;
  readonly cwd: string;
  readonly readFile: (path: string) => string | undefined;
  /** Optional bundled-workflows dir (the CLI's shipped examples). Lowest precedence. */
  readonly bundledDir?: string | undefined;
}

export interface ResolvedWorkflow {
  readonly path: string;
  readonly source: string;
}

/**
 * Resolve a saved/bundled workflow by name (design §9). Tier precedence:
 *   1. project `.workflow/workflows/`
 *   2. personal `~/.workflow/workflows/`
 *   3. bundled `${bundledDir}/`, when `bundledDir` is provided
 * Within each tier, a single-file `<name>.ts`/`.js` beats a multi-file folder entry
 * `<name>/<name>.workflow.ts`/`.js` (the shape `workflow add` ejects). `.ts` beats `.js`.
 */
export function resolveSavedWorkflow(
  name: string,
  deps: ResolveDeps,
): ResolvedWorkflow | undefined {
  const bases = [
    `${deps.cwd}/.workflow/workflows`,
    `${deps.homeDir}/.workflow/workflows`,
    ...(deps.bundledDir ? [deps.bundledDir] : []),
  ];
  const candidates = bases.flatMap((base) => [
    `${base}/${name}.ts`,
    `${base}/${name}.js`,
    `${base}/${name}/${name}.workflow.ts`,
    `${base}/${name}/${name}.workflow.js`,
  ]);
  for (const path of candidates) {
    const source = deps.readFile(path);
    if (source !== undefined) return { path, source };
  }
  return undefined;
}
