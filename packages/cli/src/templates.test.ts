import { describe, it, expect } from "vitest";
import { loadTemplateIndex } from "./templates.js";
import { fakeDeps } from "./test-support.js";

const VALID = JSON.stringify({
  version: 1,
  templates: [
    {
      name: "pr-review",
      description: "Review a diff",
      harness: "claude",
      complexity: "beginner",
      agents: 1,
      recommended: true,
      multiFile: false,
      entry: "pr-review.workflow.ts",
    },
  ],
});

describe("loadTemplateIndex", () => {
  it("errors (does not throw) when the index is missing", () => {
    const { deps } = fakeDeps({ env: { templatesDir: "/t" } });
    const result = loadTemplateIndex(deps);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toContain("not found");
  });

  it("errors on invalid JSON", () => {
    const { deps } = fakeDeps({ env: { templatesDir: "/t" }, _files: { "/t/index.json": "{bad" } });
    const result = loadTemplateIndex(deps);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toContain("malformed");
  });

  it("errors on an unknown manifest version", () => {
    const bad = JSON.stringify({ version: 2, templates: [] });
    const { deps } = fakeDeps({ env: { templatesDir: "/t" }, _files: { "/t/index.json": bad } });
    expect(loadTemplateIndex(deps).isErr()).toBe(true);
  });

  it("parses a valid index and defaults tags/recommended", () => {
    const { deps } = fakeDeps({ env: { templatesDir: "/t" }, _files: { "/t/index.json": VALID } });
    const result = loadTemplateIndex(deps);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.templates).toHaveLength(1);
      expect(result.value.templates[0]!.name).toBe("pr-review");
      expect(result.value.templates[0]!.recommended).toBe(true);
      expect(result.value.templates[0]!.tags).toEqual([]);
    }
  });
});
