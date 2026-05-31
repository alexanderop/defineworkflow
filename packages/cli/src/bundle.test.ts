import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleWorkflow } from "./bundle.js";

function fixture(files: Record<string, string>): { dir: string; entry: string } {
  const dir = mkdtempSync(join(tmpdir(), "wf-bundle-"));
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return { dir, entry: join(dir, "entry.workflow.ts") };
}

describe("bundleWorkflow", () => {
  it("returns the source unchanged when there are no local imports", async () => {
    const source = `import { defineWorkflow, agent } from "defineworkflow";\nexport default defineWorkflow({ name: "x", description: "d", harness: "claude", async run() { return await agent("hi"); } });\n`;
    const result = await bundleWorkflow({ path: "/does/not/matter.ts", source });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(source);
  });

  it("inlines a local schema import and keeps defineworkflow external", async () => {
    const { dir, entry } = fixture({
      "schemas.ts": `import { z } from "defineworkflow";\nexport const ResearchSchema = z.object({ summary: z.string() });\n`,
      "entry.workflow.ts": `import { agent, defineWorkflow } from "defineworkflow";\nimport { ResearchSchema } from "./schemas";\nexport default defineWorkflow({ name: "spike", description: "d", harness: "claude", async run() { return await agent("hi", { schema: ResearchSchema }); } });\n`,
    });
    try {
      const result = await bundleWorkflow({ path: entry, source: "import { x } from \"./schemas\";" });
      expect(result.isOk()).toBe(true);
      const code = result._unsafeUnwrap();
      expect(code).toContain("z.object({ summary: z.string() })"); // helper inlined
      expect(code).toContain("export {"); // esbuild default re-export shape
      expect(code).toContain("as default"); // captured by sandbox later
      expect(code).toContain('from "defineworkflow"'); // kept external (not inlined)
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an npm import with a clear error", async () => {
    const { dir, entry } = fixture({
      "entry.workflow.ts": `import { defineWorkflow } from "defineworkflow";\nimport _ from "lodash";\nexport default defineWorkflow({ name: "x", description: "d", harness: "claude", async run() { return _; } });\n`,
    });
    try {
      const result = await bundleWorkflow({ path: entry, source: `import x from "./missing";` });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatch(/only import local files or "defineworkflow"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
