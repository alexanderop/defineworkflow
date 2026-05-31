import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./run.js";
import { fakeDeps, memFs } from "../test-support.js";
import { createRegistry } from "../registry.js";

describe("runCommand multi-file", () => {
  it("bundles local imports and snapshots the self-contained source (--mock)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wf-run-"));
    writeFileSync(
      join(dir, "schemas.ts"),
      `import { z } from "defineworkflow";\nexport const S = z.object({ summary: z.string() });\n`,
    );
    const entry = join(dir, "wf.workflow.ts");
    writeFileSync(
      entry,
      `import { agent, defineWorkflow } from "defineworkflow";\nimport { S } from "./schemas";\n` +
        `export default defineWorkflow({ name: "mf", description: "d", harness: "claude", async run() { return await agent("hi", { schema: S }); } });\n`,
    );
    try {
      const fs = memFs();
      const registry = createRegistry({ root: "/runs", fs });
      const { deps } = fakeDeps({
        registry,
        io: { readText: (p: string) => (p === entry ? readFileSync(entry, "utf8") : undefined) },
      });

      const code = await runCommand({ script: entry, detach: false, yes: true, mock: true }, deps);
      expect(code).toBe(0);

      const snapshot = [...fs.files].find(([k]) => k.endsWith("script.snapshot"))?.[1] ?? "";
      expect(snapshot).toContain("z.object({ summary: z.string() })"); // helper inlined
      expect(snapshot).not.toMatch(/from\s*["']\.\//); // no relative imports remain
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
