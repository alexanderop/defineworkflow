import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workflowSource } from "@workflow/test-support";
import { runCommand } from "./run.js";
import { fakeDeps, memFs } from "../test-support.js";
import { createRegistry } from "../registry.js";

const CONSENT_SRC = workflowSource({ name: "needs-consent", harness: "raw-api" });

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

describe("runCommand consent gate", () => {
  it("aborts (exit 1) and never starts a run when the user declines at the prompt", async () => {
    const { deps, out } = fakeDeps({
      _files: { "/wf.ts": CONSENT_SRC },
      env: { isTTY: true }, // forces decideConsent() -> "prompt"
      consent: { io: { question: async () => "n", write: () => {} } },
    });

    const code = await runCommand({ script: "/wf.ts", detach: false, yes: false }, deps);

    expect(code).toBe(1);
    expect(out()).toContain("aborted");
    expect(deps.registry.listRuns()).toHaveLength(0);
  });

  it("persists consent and starts the run when the user answers 'always'", async () => {
    const persisted: Array<{ project: string; name: string }> = [];
    const { deps } = fakeDeps({
      _files: { "/wf.ts": CONSENT_SRC },
      env: { isTTY: true },
      consent: {
        io: { question: async () => "a", write: () => {} },
        persist: (project, name) => void persisted.push({ project, name }),
      },
      ui: { start: () => ({ unmount: () => {} }) },
    });

    const code = await runCommand({ script: "/wf.ts", detach: false, yes: false }, deps);

    expect(code).toBe(0);
    expect(persisted).toEqual([{ project: "/proj", name: "needs-consent" }]);
    expect(deps.registry.listRuns()).toHaveLength(1);
  });
});
