import { describe, it, expect } from "vitest";
import { runInSandbox, extractMeta } from "./sandbox.js";
import { profile, isProfile } from "./profile.js";

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

  it("preserves meta.output when declared", () => {
    const src = `export const meta = { name: "n", description: "d", harness: "claude", output: "./newsletters", phases: [] };\nreturn 1;`;
    expect(extractMeta(src).output).toBe("./newsletters");
  });

  it("rejects a non-string meta.output", () => {
    const src = `export const meta = { name: "n", description: "d", harness: "claude", output: 42, phases: [] };\nreturn 1;`;
    expect(() => extractMeta(src)).toThrow(/meta\.output/);
  });

  it("allows authoring imports from the published defineworkflow package", async () => {
    const src = `
      import { agent, phase, type WorkflowMeta, type JsonSchema } from "defineworkflow";

      export const meta = { name: "demo", description: "d", harness: "claude", phases: [{ title: "Run" }] } satisfies WorkflowMeta;
      phase("Run");
      const Out: JsonSchema = { type: "object", properties: { answer: { type: "number" } }, required: ["answer"] };
      const result = await agent("answer", { schema: Out });
      return result;
    `;
    const result = await runInSandbox(src, {
      agent: async () => ({ answer: 42 }),
      phase: () => {},
    });
    expect(result.meta.name).toBe("demo");
    expect(result.returnValue).toEqual({ answer: 42 });
  });

  it("strips `import { profile }` and resolves the injected profile global", async () => {
    const src = `
      import { agent, defineWorkflow, profile } from "defineworkflow";

      export default defineWorkflow({
        name: "with-profile",
        description: "uses a profile",
        harness: "claude",
        phases: [{ title: "Run" }],
        async run() {
          const reviewer = profile({ model: "sonnet", instructions: "Be terse." });
          return await agent(reviewer, "review this");
        },
      });
    `;
    const seen: unknown[] = [];
    const result = await runInSandbox(src, {
      defineWorkflow: (workflow: unknown) => workflow,
      profile,
      agent: async (first: unknown) => {
        seen.push(first);
        return "ok";
      },
      parallel: async () => [],
      pipeline: async () => [],
      workflow: async () => null,
      phase: () => {},
      log: () => {},
      args: null,
      budget: { total: null, spent: () => 0, remaining: () => Infinity, record: () => {} },
    });
    expect(result.returnValue).toBe("ok");
    // The stripped import resolved to the injected global, producing a branded Profile that
    // flowed through as agent()'s first argument.
    expect(isProfile(seen[0])).toBe(true);
  });

  it("runs a workflow exported with defineWorkflow()", async () => {
    const src = `
      import { defineWorkflow, agent } from "workflow";

      export default defineWorkflow({
        name: "defined",
        description: "defined workflow",
        harness: "claude",
        phases: [{ title: "Run" }],
        async run() {
          const out = await agent("hello", { label: "a" });
          return { out };
        },
      });
    `;
    const result = await runInSandbox(src, {
      defineWorkflow: (workflow: unknown) => workflow,
      agent: async () => "hit",
      parallel: async () => [],
      pipeline: async () => [],
      workflow: async () => null,
      phase: () => {},
      log: () => {},
      args: null,
      budget: { total: null, spent: () => 0, remaining: () => Infinity, record: () => {} },
    });
    expect(result.meta).toMatchObject({ name: "defined", harness: "claude", phases: [{ title: "Run" }] });
    expect(result.returnValue).toEqual({ out: "hit" });
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

  it("treats export default as the workflow return value", async () => {
    const src = `export const meta = { name: "n", description: "n", harness: "claude", phases: [] } satisfies WorkflowMeta;
const answer = await getValue();
export default { answer };`;
    const result = await runInSandbox(src, { getValue: async () => 42 });
    expect(result.returnValue).toEqual({ answer: 42 });
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
    const src = `export const meta = { name: "demo", description: "d", whenToUse: "demo work", harness: "claude", phases: [{ title: "A" }] } as const
const x = await agent("should never run");
return x;`;
    const meta = extractMeta(src);
    expect(meta.name).toBe("demo");
    expect(meta.whenToUse).toBe("demo work");
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
