export interface ResolveDeps {
  readonly homeDir: string;
  readonly cwd: string;
  readonly readFile: (path: string) => string | undefined;
}

export interface ResolvedWorkflow {
  readonly path: string;
  readonly source: string;
}

/**
 * Resolve a saved/bundled workflow by name (design §9): project `.workflow/workflows/`
 * wins over personal `~/.workflow/workflows/`, and `.ts` wins over `.js` within a scope.
 */
export function resolveSavedWorkflow(name: string, deps: ResolveDeps): ResolvedWorkflow | undefined {
  const candidates = [
    `${deps.cwd}/.workflow/workflows/${name}.ts`,
    `${deps.cwd}/.workflow/workflows/${name}.js`,
    `${deps.homeDir}/.workflow/workflows/${name}.ts`,
    `${deps.homeDir}/.workflow/workflows/${name}.js`,
  ];
  for (const path of candidates) {
    const source = deps.readFile(path);
    if (source !== undefined) return { path, source };
  }
  return undefined;
}
