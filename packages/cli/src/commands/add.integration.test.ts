import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addCommand } from "./add.js";
import { fakeDeps } from "../test-support.js";
import { resolveSavedWorkflow } from "../resolve.js";
import { RegistryBlob } from "../recipes.js";

// Proves the full eject loop against the REAL committed registry blob (no network):
//   generated registry/r/deep-research.json → addCommand → files on disk → run-by-name resolves.
describe("recipes eject loop (real generated blob)", () => {
  const blobPath = join(process.cwd(), "registry", "r", "deep-research.json");
  const blobJson = readFileSync(blobPath, "utf8");

  it("the generated blob is a valid RegistryBlob", () => {
    expect(RegistryBlob.safeParse(JSON.parse(blobJson)).success).toBe(true);
  });

  it("add ejects every file and run-by-name resolves the entry", async () => {
    const { deps } = fakeDeps({ net: { fetchText: async () => blobJson } });
    expect(await addCommand({ name: "deep-research", force: false }, deps)).toBe(0);

    const blob = RegistryBlob.parse(JSON.parse(blobJson));
    const dir = "/proj/.workflow/workflows/deep-research";
    for (const f of blob.files) {
      expect(deps.io.readText(`${dir}/${f.path}`)).toBe(f.content);
    }

    // run-by-name (the existing resolver) finds the ejected folder's entry file.
    const resolved = resolveSavedWorkflow("deep-research", {
      homeDir: "/home/me",
      cwd: "/proj",
      readFile: deps.io.readText,
    });
    expect(resolved?.path).toBe(`${dir}/deep-research.workflow.ts`);
    expect(resolved?.source).toContain("defineWorkflow(");
  });
});
