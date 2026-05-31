import { describe, it, expect } from "vitest";
import { runInSandbox, extractMeta, transformScript } from "./sandbox.js";
import { profile, isProfile } from "./profile.js";

describe("sandbox", () => {
  // Regression: the import-matching regexes must stay linear. An `import` token
  // followed by a long whitespace run with no `from` fed a
  // polynomial-backtracking `[\s\S]*?` flanked by `\s+` and could hang (ReDoS).
  it("matches imports in linear time on a pathological line", () => {
    // `import` + a long whitespace run with no `from` is invalid JS, so the
    // downstream transform rejects it — but the import-matching regexes run
    // first, and under the old polynomial pattern they hung before ever
    // reaching that point. We only assert the call returns promptly.
    const src = "import " + " ".repeat(100_000) + "x";
    const start = performance.now();
    expect(() => transformScript(src)).toThrow();
    expect(performance.now() - start).toBeLessThan(1000);
  });

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
      askUserQuestion: async () => "",
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
      askUserQuestion: async () => "",
      args: null,
      budget: { total: null, spent: () => 0, remaining: () => Infinity, record: () => {} },
    });
    expect(result.meta).toMatchObject({
      name: "defined",
      harness: "claude",
      phases: [{ title: "Run" }],
    });
    expect(result.returnValue).toEqual({ out: "hit" });
  });

  it("runs a bundled workflow (esbuild default-export shape)", async () => {
    const src = [
      `import { agent, defineWorkflow } from "defineworkflow";`,
      `import { z } from "defineworkflow";`,
      `var ResearchSchema = z.object({ summary: z.string() });`,
      `var entry_workflow_default = defineWorkflow({`,
      `  name: "bundled", description: "d", harness: "claude", phases: [{ title: "Run" }],`,
      `  async run() { const out = await agent("hi", { schema: ResearchSchema }); return { out }; }`,
      `});`,
      `export {`,
      `  entry_workflow_default as default`,
      `};`,
    ].join("\n");
    const result = await runInSandbox(src, {
      defineWorkflow: (workflow: unknown) => workflow,
      z: { object: (x: unknown) => x, string: () => ({}) },
      agent: async () => "hit",
      parallel: async () => [],
      pipeline: async () => [],
      workflow: async () => null,
      phase: () => {},
      log: () => {},
      askUserQuestion: async () => "",
      args: null,
      budget: { total: null, spent: () => 0, remaining: () => Infinity, record: () => {} },
    });
    expect(result.meta).toMatchObject({
      name: "bundled",
      harness: "claude",
      phases: [{ title: "Run" }],
    });
    expect(result.returnValue).toEqual({ out: "hit" });
  });

  it("runs a bundled workflow that also has a sibling named export", async () => {
    const src = [
      `import { agent, defineWorkflow } from "defineworkflow";`,
      `var meta = { tool: "x" };`,
      `var entry_workflow_default = defineWorkflow({`,
      `  name: "bundled2", description: "d", harness: "claude",`,
      `  async run() { return await agent("hi"); }`,
      `});`,
      `export {`,
      `  entry_workflow_default as default,`,
      `  meta`,
      `};`,
    ].join("\n");
    const result = await runInSandbox(src, {
      defineWorkflow: (workflow: unknown) => workflow,
      agent: async () => "hit",
      parallel: async () => [],
      pipeline: async () => [],
      workflow: async () => null,
      phase: () => {},
      log: () => {},
      askUserQuestion: async () => "",
      args: null,
      budget: { total: null, spent: () => 0, remaining: () => Infinity, record: () => {} },
    });
    expect(result.meta).toMatchObject({ name: "bundled2", harness: "claude" });
    expect(result.returnValue).toEqual("hit");
  });

  it("provides URL and URLSearchParams to workflow scripts", async () => {
    const src = `
      import { defineWorkflow } from "defineworkflow";

      export default defineWorkflow({
        name: "url-test",
        description: "uses URL",
        harness: "claude",
        phases: [{ title: "Run" }],
        async run() {
          const u = new URL("https://www.example.com/a/b?x=1");
          const sp = new URLSearchParams("a=1&b=2");
          return { host: u.hostname, path: u.pathname, x: u.searchParams.get("x"), a: sp.get("a") };
        },
      });
    `;
    const result = await runInSandbox(src, {
      defineWorkflow: (workflow: unknown) => workflow,
      agent: async () => "",
      parallel: async () => [],
      pipeline: async () => [],
      workflow: async () => null,
      phase: () => {},
      log: () => {},
      askUserQuestion: async () => "",
      args: null,
      budget: { total: null, spent: () => 0, remaining: () => Infinity, record: () => {} },
    });
    expect(result.returnValue).toEqual({ host: "www.example.com", path: "/a/b", x: "1", a: "1" });
  });

  it("throws SandboxViolation when the script calls Date.now()", async () => {
    const src = `export const meta = { name: "x", description: "x", harness: "claude", phases: [] };\n const t = Date.now(); return t;`;
    await expect(runInSandbox(src, {})).rejects.toThrow(/SandboxViolation|Date.now/);
  });

  it("throws SandboxViolation when the script calls Math.random()", async () => {
    const src = `export const meta = { name: "x", description: "x", harness: "claude", phases: [] };\n return Math.random();`;
    await expect(runInSandbox(src, {})).rejects.toThrow(/SandboxViolation|Math.random/);
  });

  it("throws SandboxViolation on argless new Date() (determinism guard)", async () => {
    const src = `export const meta = { name: "x", description: "x", harness: "claude", phases: [] };\nreturn new Date().getUTCFullYear();`;
    await expect(runInSandbox(src, {})).rejects.toThrow(/argless new Date\(\) is not allowed/);
  });

  it("allows deterministic Date forms: new Date(ms), Date.parse, Date.UTC", async () => {
    const src = `export const meta = { name: "x", description: "x", harness: "claude", phases: [] };
return { y: new Date(0).getUTCFullYear(), p: Date.parse("1970-01-01T00:00:00Z"), u: Date.UTC(2020, 0, 1) };`;
    const result = await runInSandbox(src, {});
    expect(result.returnValue).toEqual({ y: 1970, p: 0, u: Date.UTC(2020, 0, 1) });
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

  it("ignores a defineWorkflow export named inside a JSDoc comment", async () => {
    const src = `import { defineWorkflow } from "defineworkflow";

/**
 * NOTE: the engine requires \`export default defineWorkflow(...)\` to be first.
 */
export default defineWorkflow({
  name: "commented",
  description: "has a comment mentioning the export",
  harness: "claude",
  phases: [{ title: "Run" }],
  async run() {
    return { ok: true };
  },
});`;
    const result = await runInSandbox(src, {
      defineWorkflow: (workflow: unknown) => workflow,
      agent: async () => "",
      parallel: async () => [],
      pipeline: async () => [],
      workflow: async () => null,
      phase: () => {},
      log: () => {},
      askUserQuestion: async () => "",
      args: null,
      budget: { total: null, spent: () => 0, remaining: () => Infinity, record: () => {} },
    });
    expect(result.meta).toMatchObject({ name: "commented", harness: "claude" });
    expect(result.returnValue).toEqual({ ok: true });
  });

  it("ignores a meta export mentioned in a comment and a string literal", async () => {
    const src = `// to use this, write: export const meta = { … }
export const meta = { name: "real", description: "d", harness: "claude", phases: [] };
const hint = "export const meta = { fake: true }";
return hint.length;`;
    const result = await runInSandbox(src, {});
    expect(result.meta.name).toBe("real");
    expect(typeof result.returnValue).toBe("number");
  });
});

describe("extractMeta", () => {
  it("reads the real meta when a comment mentions a different export form", () => {
    const src = `/** example: export default defineWorkflow({ name: "fake" }) */
export const meta = { name: "true-meta", description: "d", harness: "claude", phases: [] };
export default {};`;
    expect(extractMeta(src).name).toBe("true-meta");
  });

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
    const src =
      'export const meta = { name: `wf-${id}`, description: "d", harness: "claude" };\nreturn 1;';
    expect(() => extractMeta(src)).toThrow(/SandboxViolation: template interpolation not allowed/);
  });

  it("reads meta from esbuild bundled output (defineWorkflow not first)", () => {
    const src = [
      `import { agent, defineWorkflow } from "defineworkflow";`,
      `import { z } from "defineworkflow";`,
      `var S = z.object({ a: z.string() });`,
      `var entry_workflow_default = defineWorkflow({ name: "bundled", description: "d", harness: "claude" });`,
      `export { entry_workflow_default as default };`,
    ].join("\n");
    expect(extractMeta(src)).toMatchObject({
      name: "bundled",
      description: "d",
      harness: "claude",
    });
  });

  it("rejects meta that is not the first statement", () => {
    const src = `const x = 1;\nexport const meta = { name: "x", description: "d", harness: "claude" };\nreturn 1;`;
    expect(() => extractMeta(src)).toThrow(/SandboxViolation: .*first statement/);
  });
  it('rejects a raw `import … from "zod"` and points at the defineworkflow re-export', () => {
    const src = `
      import { agent, defineWorkflow } from "defineworkflow";
      import { z } from "zod";

      export default defineWorkflow({
        name: "n", description: "d", harness: "claude", phases: [],
        async run() { return await agent("hi", { schema: z.object({ n: z.number() }) }); },
      });
    `;
    expect(() => extractMeta(src)).toThrow(
      /SandboxViolation: cannot import from "zod".*defineworkflow/s,
    );
  });

  it("names a non-zod foreign import in the SandboxViolation", () => {
    const src = `
      import { defineWorkflow } from "defineworkflow";
      import { merge } from "lodash";

      export default defineWorkflow({
        name: "n", description: "d", harness: "claude", phases: [],
        async run() { return merge({}, {}); },
      });
    `;
    expect(() => extractMeta(src)).toThrow(/SandboxViolation: cannot import from "lodash"/);
  });

  it("rejects a reserved __proto__ key in meta (prototype-pollution guard)", () => {
    const src = `export const meta = { name: "x", description: "d", harness: "claude", __proto__: { polluted: true } };\nreturn 1;`;
    expect(() => extractMeta(src)).toThrow(/reserved key name not allowed in meta: __proto__/);
  });

  it("rejects a reserved constructor key nested inside meta", () => {
    const src = `export const meta = { name: "x", description: "d", harness: "claude", phases: [{ constructor: 1 }] };\nreturn 1;`;
    expect(() => extractMeta(src)).toThrow(/reserved key name not allowed/);
  });

  it("rejects an empty/whitespace meta.name", () => {
    const src = `export const meta = { name: "  ", description: "d", harness: "claude", phases: [] };\nreturn 1;`;
    expect(() => extractMeta(src)).toThrow(/meta\.name must be a non-empty string/);
  });

  it("rejects a non-string meta.description", () => {
    const src = `export const meta = { name: "x", description: 42, harness: "claude", phases: [] };\nreturn 1;`;
    expect(() => extractMeta(src)).toThrow(/meta\.description must be a non-empty string/);
  });

  it("rejects a non-string meta.whenToUse", () => {
    const src = `export const meta = { name: "x", description: "d", whenToUse: 5, harness: "claude", phases: [] };\nreturn 1;`;
    expect(() => extractMeta(src)).toThrow(/meta\.whenToUse must be a string/);
  });

  it("rejects a non-array meta.phases", () => {
    const src = `export const meta = { name: "x", description: "d", harness: "claude", phases: "nope" };\nreturn 1;`;
    expect(() => extractMeta(src)).toThrow(/meta\.phases must be an array/);
  });
});
