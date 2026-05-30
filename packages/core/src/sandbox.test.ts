import { describe, it, expect } from "vitest";
import { runInSandbox, extractMeta } from "./sandbox.js";

describe("sandbox", () => {
  it("extracts meta and returns the script's return value", async () => {
    const src = `
      export const meta = { name: "demo", description: "d", harness: "claude", phases: [] };
      const a = await getValue();
      return { a };
    `;
    const result = await runInSandbox(src, { getValue: async () => 42 });
    expect(result.meta.name).toBe("demo");
    expect(result.returnValue).toEqual({ a: 42 });
  });

  it("throws SandboxViolation when the script calls Date.now()", async () => {
    const src = `export const meta = { name: "x", description: "x", harness: "claude", phases: [] };\n const t = Date.now(); return t;`;
    await expect(runInSandbox(src, {})).rejects.toThrow(/SandboxViolation|Date.now/);
  });

  it("throws SandboxViolation when the script calls Math.random()", async () => {
    const src = `export const meta = { name: "x", description: "x", harness: "claude", phases: [] };\n return Math.random();`;
    await expect(runInSandbox(src, {})).rejects.toThrow(/SandboxViolation|Math.random/);
  });

  it("captures meta with no trailing semicolon (ASI)", async () => {
    const src = `export const meta = { name: "n", description: "n", harness: "claude", phases: [] }\nreturn 1;`;
    const result = await runInSandbox(src, {});
    expect(result.meta.name).toBe("n");
    expect(result.returnValue).toBe(1);
  });

  it("captures meta whose strings contain semicolons", async () => {
    const src = `export const meta = { name: "n", description: "do a; then b", harness: "claude", phases: [] };\nreturn 2;`;
    const result = await runInSandbox(src, {});
    expect(result.meta.name).toBe("n");
    expect(result.meta.description).toBe("do a; then b");
    expect(result.returnValue).toBe(2);
  });
});

describe("extractMeta", () => {
  it("reads meta without executing agent calls", () => {
    const src = `export const meta = { name: "demo", description: "d", harness: "claude", phases: [{ title: "A" }] } as const
const x = await agent("should never run");
return x;`;
    const meta = extractMeta(src);
    expect(meta.name).toBe("demo");
    expect(meta.phases).toEqual([{ title: "A" }]);
  });

  it("throws when meta is missing", () => {
    expect(() => extractMeta(`const y = 1; export {};`)).toThrow(/must export `const meta`/);
  });

  it("rejects a non-literal meta (function call) without executing it", () => {
    const src = `export const meta = build();\nreturn 1;`;
    expect(() => extractMeta(src)).toThrow(/SandboxViolation: non-literal value in meta/);
  });

  it("rejects a spread inside meta", () => {
    const src = `export const meta = { ...base, name: "x", description: "d", harness: "claude" };\nreturn 1;`;
    expect(() => extractMeta(src)).toThrow(/SandboxViolation: spread not allowed in meta/);
  });

  it("rejects template interpolation inside meta", () => {
    const src = "export const meta = { name: `wf-${id}`, description: \"d\", harness: \"claude\" };\nreturn 1;";
    expect(() => extractMeta(src)).toThrow(/SandboxViolation: template interpolation not allowed/);
  });

  it("rejects meta that is not the first statement", () => {
    const src = `const x = 1;\nexport const meta = { name: "x", description: "d", harness: "claude" };\nreturn 1;`;
    expect(() => extractMeta(src)).toThrow(/SandboxViolation: .*first statement/);
  });
});
