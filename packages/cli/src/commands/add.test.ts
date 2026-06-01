import { describe, it, expect } from "vitest";
import { addCommand } from "./add.js";
import { fakeDeps } from "../test-support.js";
import { hashFiles, recipeUrl } from "../recipes.js";

const NAME = "deep-research";
const DIR = `/proj/.workflow/workflows/${NAME}`;
const LOCK = `/proj/.workflow/recipes.lock.json`;

const blob = (version: string, files: { path: string; content: string }[]): string =>
  JSON.stringify({ name: NAME, version, files });

const FILES = [
  { path: "deep-research.workflow.ts", content: "export default {}\n" },
  { path: "schemas.ts", content: "export const X = 1\n" },
];

function depsWith(blobJson: string | undefined, files: Record<string, string> = {}) {
  return fakeDeps({ _files: files, net: { fetchText: async () => blobJson } });
}

describe("addCommand", () => {
  it("first eject writes files and creates the lock", async () => {
    const { deps } = depsWith(blob("1.0.0", FILES));
    const code = await addCommand({ name: NAME, force: false }, deps);
    expect(code).toBe(0);
    expect(deps.io.readText(`${DIR}/deep-research.workflow.ts`)).toBe("export default {}\n");
    expect(deps.io.readText(`${DIR}/schemas.ts`)).toBe("export const X = 1\n");
    const lock = JSON.parse(deps.io.readText(LOCK)!);
    expect(lock[NAME].version).toBe("1.0.0");
    expect(lock[NAME].url).toBe(recipeUrl(NAME));
    expect(lock[NAME].hash).toBe(hashFiles(FILES));
    expect(typeof lock[NAME].ejectedAt).toBe("number");
  });

  it("up-to-date version is a no-op", async () => {
    const seed: Record<string, string> = {
      [`${DIR}/deep-research.workflow.ts`]: FILES[0]!.content,
      [`${DIR}/schemas.ts`]: FILES[1]!.content,
      [LOCK]: JSON.stringify({
        [NAME]: { version: "1.0.0", url: recipeUrl(NAME), hash: hashFiles(FILES), ejectedAt: 1 },
      }),
    };
    const { deps, out } = depsWith(blob("1.0.0", FILES), seed);
    expect(await addCommand({ name: NAME, force: false }, deps)).toBe(0);
    expect(out()).toContain("already up to date");
  });

  it("newer + unmodified → clean overwrite + lock bump", async () => {
    const seed: Record<string, string> = {
      [`${DIR}/deep-research.workflow.ts`]: FILES[0]!.content,
      [`${DIR}/schemas.ts`]: FILES[1]!.content,
      [LOCK]: JSON.stringify({
        [NAME]: { version: "1.0.0", url: recipeUrl(NAME), hash: hashFiles(FILES), ejectedAt: 1 },
      }),
    };
    const NEW = [
      { path: "deep-research.workflow.ts", content: "export default { v: 2 }\n" },
      { path: "schemas.ts", content: "export const X = 2\n" },
    ];
    const { deps } = depsWith(blob("2.0.0", NEW), seed);
    expect(await addCommand({ name: NAME, force: false }, deps)).toBe(0);
    expect(deps.io.readText(`${DIR}/deep-research.workflow.ts`)).toBe("export default { v: 2 }\n");
    expect(JSON.parse(deps.io.readText(LOCK)!)[NAME].version).toBe("2.0.0");
  });

  it("newer + modified → refused without --force, lists changed files", async () => {
    const seed: Record<string, string> = {
      [`${DIR}/deep-research.workflow.ts`]: "LOCAL EDIT\n",
      [`${DIR}/schemas.ts`]: FILES[1]!.content,
      [LOCK]: JSON.stringify({
        [NAME]: { version: "1.0.0", url: recipeUrl(NAME), hash: hashFiles(FILES), ejectedAt: 1 },
      }),
    };
    const { deps, out } = depsWith(blob("2.0.0", FILES), seed);
    expect(await addCommand({ name: NAME, force: false }, deps)).toBe(1);
    expect(out()).toContain("local modifications");
    expect(out()).toContain("deep-research.workflow.ts");
    expect(deps.io.readText(`${DIR}/deep-research.workflow.ts`)).toBe("LOCAL EDIT\n");
  });

  it("--force overwrites regardless", async () => {
    const seed: Record<string, string> = {
      [`${DIR}/deep-research.workflow.ts`]: "LOCAL EDIT\n",
      [LOCK]: JSON.stringify({
        [NAME]: { version: "1.0.0", url: recipeUrl(NAME), hash: "sha256-stale", ejectedAt: 1 },
      }),
    };
    const { deps } = depsWith(blob("2.0.0", FILES), seed);
    expect(await addCommand({ name: NAME, force: true }, deps)).toBe(0);
    expect(deps.io.readText(`${DIR}/deep-research.workflow.ts`)).toBe(FILES[0]!.content);
    expect(JSON.parse(deps.io.readText(LOCK)!)[NAME].version).toBe("2.0.0");
  });

  it("404 / missing recipe → clear error, no files written", async () => {
    const { deps, out } = depsWith(undefined);
    expect(await addCommand({ name: NAME, force: false }, deps)).toBe(1);
    expect(out()).toContain('unknown recipe "deep-research"');
    expect(deps.io.readText(`${DIR}/schemas.ts`)).toBeUndefined();
  });

  it("malformed blob → clear error, no files written", async () => {
    const { deps, out } = depsWith('{"name":"x"}');
    expect(await addCommand({ name: NAME, force: false }, deps)).toBe(1);
    expect(out()).toContain("invalid registry blob");
    expect(deps.io.readText(`${DIR}/schemas.ts`)).toBeUndefined();
  });

  it("path-escape in a blob is rejected, no files written", async () => {
    const evil = blob("1.0.0", [{ path: "../../evil.ts", content: "x" }]);
    const { deps, out } = depsWith(evil);
    expect(await addCommand({ name: NAME, force: false }, deps)).toBe(1);
    expect(out()).toContain("unsafe file path");
    expect(deps.io.readText("/proj/.workflow/workflows/evil.ts")).toBeUndefined();
  });

  it("untracked existing directory is refused without --force", async () => {
    const seed: Record<string, string> = {
      [`${DIR}/deep-research.workflow.ts`]: "PRE-EXISTING\n",
    };
    const { deps, out } = depsWith(blob("1.0.0", FILES), seed);
    expect(await addCommand({ name: NAME, force: false }, deps)).toBe(1);
    expect(out()).toContain("already exists");
    expect(deps.io.readText(`${DIR}/deep-research.workflow.ts`)).toBe("PRE-EXISTING\n");
  });
});
