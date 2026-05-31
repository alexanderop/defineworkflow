/**
 * Turn a workflow's return value into human-friendly artifacts. A workflow that
 * returns `{ newsletter, itemCount, curated }` should leave the user with a readable
 * `newsletter.md` and the complete structured result, not a value that vanishes when
 * the run ends. `buildArtifacts` is pure (the I/O lives in `writeArtifacts`) so the
 * file-splitting convention is unit-testable without touching disk.
 */

interface Artifact {
  readonly name: string;
  readonly content: string;
}

export interface ArtifactSet {
  /** Files to persist when `meta.output` is set. `result.json` is always present. */
  readonly files: readonly Artifact[];
  /** What to print to the terminal on every successful run. */
  readonly terminal: string;
}

export type ArtifactExtension = "md" | "html" | "json" | "txt";

/** Guess a file extension for a string artifact from its content. */
export function sniffExtension(content: string): ArtifactExtension {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("<")) return "html";
  if (/^#{1,6}\s/.test(trimmed) || /```/.test(content) || /\]\(/.test(content)) return "md";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(content);
      return "json";
    } catch {
      // not valid JSON — fall through to plain text
    }
  }
  return "txt";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Derive the artifact set from a workflow's return value. Returns `null` when the
 * workflow returned `undefined` (nothing to show or persist).
 *
 * - `result.json` always holds the complete return value, verbatim.
 * - Each top-level string field is also extracted to `<key>.<ext>` for readability.
 * - A bare string return value is written as `output.<ext>` and printed raw.
 */
export function buildArtifacts(returnValue: unknown): ArtifactSet | null {
  if (returnValue === undefined) return null;

  const files: Artifact[] = [
    { name: "result.json", content: JSON.stringify(returnValue, null, 2) },
  ];

  if (typeof returnValue === "string") {
    files.push({ name: `output.${sniffExtension(returnValue)}`, content: returnValue });
    return { files, terminal: returnValue };
  }

  if (isPlainObject(returnValue)) {
    for (const [key, value] of Object.entries(returnValue)) {
      if (typeof value === "string") {
        files.push({ name: `${key}.${sniffExtension(value)}`, content: value });
      }
    }
  }

  return { files, terminal: JSON.stringify(returnValue, null, 2) };
}

/**
 * Resolve a workflow's `meta.output` to an absolute directory, or `null` when it is
 * unset (artifacts are then printed to the terminal only, never written to disk).
 * Relative paths resolve against the run's cwd.
 */
export function resolveOutputDir(output: string | undefined, cwd: string): string | null {
  if (output === undefined) return null;
  if (output.startsWith("/")) return output;
  const rel = output.startsWith("./") ? output.slice(2) : output;
  return `${cwd}/${rel}`;
}

/** Persist an artifact set under `dir`, returning the filenames written. */
export function writeArtifacts(
  set: ArtifactSet,
  dir: string,
  write: (path: string, content: string) => void,
): readonly string[] {
  for (const file of set.files) {
    write(`${dir}/${file.name}`, file.content);
  }
  return set.files.map((f) => f.name);
}
