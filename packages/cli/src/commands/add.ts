import type { AppDeps } from "../app.js";
import {
  recipeUrl,
  RegistryBlob,
  RecipesLock,
  type LockEntry,
  hashFiles,
  compareVersions,
  isSafeRelativePath,
} from "../recipes.js";

export interface AddArgs {
  readonly name: string;
  readonly force: boolean;
}

type AddDeps = Pick<AppDeps, "net" | "io" | "clock" | "env" | "ui">;

/** Fetch a recipe blob, version/hash-check it against the lockfile, eject its files. */
export async function addCommand(args: AddArgs, deps: AddDeps): Promise<number> {
  const { name, force } = args;
  const url = recipeUrl(name);

  const text = await deps.net.fetchText(url);
  if (text === undefined) {
    deps.ui.print(`error: unknown recipe "${name}"\n`);
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    deps.ui.print(`error: recipe "${name}" returned invalid JSON\n`);
    return 1;
  }
  const blobResult = RegistryBlob.safeParse(parsed);
  if (!blobResult.success) {
    deps.ui.print(`error: recipe "${name}" has an invalid registry blob\n`);
    return 1;
  }
  const blob = blobResult.data;

  const unsafe = blob.files.filter((f) => !isSafeRelativePath(f.path));
  if (unsafe.length > 0) {
    deps.ui.print(
      `error: recipe "${name}" contains unsafe file path(s): ${unsafe.map((f) => f.path).join(", ")}\n`,
    );
    return 1;
  }

  const dir = `${deps.env.cwd}/.workflow/workflows/${name}`;
  const lockPath = `${deps.env.cwd}/.workflow/recipes.lock.json`;
  const onDisk = (p: string): string | undefined => deps.io.readText(`${dir}/${p}`);

  // Load the lockfile. A present-but-corrupt lock must FAIL rather than reset to `{}`:
  // writing a fresh lock derived from `{}` would clobber every other recipe's entry.
  let lock: RecipesLock = {};
  const lockRaw = deps.io.readText(lockPath);
  if (lockRaw !== undefined && lockRaw.trim().length > 0) {
    let lockJson: unknown;
    try {
      lockJson = JSON.parse(lockRaw);
    } catch {
      deps.ui.print(`error: ${lockPath} is not valid JSON; fix or delete it before running add\n`);
      return 1;
    }
    const r = RecipesLock.safeParse(lockJson);
    if (!r.success) {
      deps.ui.print(
        `error: ${lockPath} is corrupt (does not match the lockfile schema); fix or delete it\n`,
      );
      return 1;
    }
    lock = r.data;
  }
  const entry = lock[name];
  const blobHash = hashFiles(blob.files);

  if (!force) {
    if (entry) {
      if (compareVersions(blob.version, entry.version) <= 0) {
        deps.ui.print(`${name} is already up to date (v${entry.version})\n`);
        return 0;
      }
      // Hash the on-disk content for the *previously ejected* file set (recorded in the lock),
      // not the incoming blob's — otherwise a new version that adds/removes a file hashes
      // differently from lock.hash and falsely flags an unmodified checkout as modified. Locks
      // written before `files` existed fall back to the incoming blob's path set.
      const lockedPaths = entry.files ?? blob.files.map((f) => f.path);
      const onDiskHash = hashFiles(lockedPaths.map((p) => ({ path: p, content: onDisk(p) ?? "" })));
      if (onDiskHash !== entry.hash) {
        const changed = blob.files.filter((f) => (onDisk(f.path) ?? "") !== f.content);
        deps.ui.print(
          `error: ${name} has local modifications; refusing to overwrite.\n` +
            `Divergent files:\n` +
            changed.map((f) => `  - ${f.path}`).join("\n") +
            `\nRe-run with --force to overwrite.\n`,
        );
        return 1;
      }
    } else if (blob.files.some((f) => onDisk(f.path) !== undefined)) {
      deps.ui.print(
        `error: ${dir} already exists but is not tracked in the lockfile; ` +
          `re-run with --force to overwrite.\n`,
      );
      return 1;
    }
  }

  for (const f of blob.files) deps.io.writeText(`${dir}/${f.path}`, f.content);

  const newEntry: LockEntry = {
    version: blob.version,
    url,
    hash: blobHash,
    ejectedAt: deps.clock.now(),
    files: blob.files.map((f) => f.path).toSorted(),
  };
  deps.io.writeText(lockPath, `${JSON.stringify({ ...lock, [name]: newEntry }, null, 2)}\n`);

  deps.ui.print(`added ${name}@${blob.version} → ${dir}\nnext: workflow ${name} --args '{…}'\n`);
  return 0;
}
