import { describe, it, expect } from "vitest";
import {
  hashFiles,
  compareVersions,
  isSafeRelativePath,
  buildBlob,
  parseRecipeVersion,
  recipeUrl,
  RegistryBlob,
} from "./recipes.js";

describe("hashFiles", () => {
  it("is order-independent", () => {
    const a = hashFiles([
      { path: "a", content: "1" },
      { path: "b", content: "2" },
    ]);
    const b = hashFiles([
      { path: "b", content: "2" },
      { path: "a", content: "1" },
    ]);
    expect(a).toBe(b);
  });
  it("detects a content change", () => {
    const a = hashFiles([{ path: "a", content: "1" }]);
    const b = hashFiles([{ path: "a", content: "2" }]);
    expect(a).not.toBe(b);
  });
  it("is prefixed sha256-", () => {
    expect(hashFiles([{ path: "a", content: "1" }])).toMatch(/^sha256-[0-9a-f]{64}$/);
  });
});

describe("compareVersions", () => {
  it("orders numerically left-to-right", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  it("treats missing trailing parts as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });
});

describe("isSafeRelativePath", () => {
  it("accepts plain relative files", () => {
    expect(isSafeRelativePath("a/b.ts")).toBe(true);
    expect(isSafeRelativePath("deep-research.workflow.ts")).toBe(true);
  });
  it("rejects traversal and absolute paths", () => {
    expect(isSafeRelativePath("../x")).toBe(false);
    expect(isSafeRelativePath("a/../../x")).toBe(false);
    expect(isSafeRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRelativePath("C:\\x")).toBe(false);
    expect(isSafeRelativePath("")).toBe(false);
  });
});

describe("buildBlob / parseRecipeVersion", () => {
  it("assembles a sorted, validatable blob", () => {
    const blob = buildBlob("r", "1.0.0", [
      { path: "z.ts", content: "Z" },
      { path: "a.ts", content: "A" },
    ]);
    expect(blob.files.map((f) => f.path)).toEqual(["a.ts", "z.ts"]);
    expect(RegistryBlob.safeParse(blob).success).toBe(true);
  });
  it("reads version from recipe.json, undefined when missing/invalid", () => {
    expect(parseRecipeVersion('{"version":"1.2.3"}')).toBe("1.2.3");
    expect(parseRecipeVersion("{}")).toBeUndefined();
    expect(parseRecipeVersion("not json")).toBeUndefined();
    expect(parseRecipeVersion(undefined)).toBeUndefined();
  });
});

describe("recipeUrl", () => {
  it("builds the raw registry url", () => {
    expect(recipeUrl("deep-research")).toBe(
      "https://raw.githubusercontent.com/alexanderop/defineworkflow/main/registry/r/deep-research.json",
    );
  });
});
