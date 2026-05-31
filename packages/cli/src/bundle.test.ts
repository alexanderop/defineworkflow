import { describe, it, expect } from "vitest";
import { bundleWorkflow } from "./bundle.js";

describe("bundleWorkflow", () => {
  it("returns the source unchanged when there are no local imports", async () => {
    const source = `import { defineWorkflow, agent } from "defineworkflow";\nexport default defineWorkflow({ name: "x", description: "d", harness: "claude", async run() { return await agent("hi"); } });\n`;
    const result = await bundleWorkflow({ path: "/does/not/matter.ts", source });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(source);
  });
});
