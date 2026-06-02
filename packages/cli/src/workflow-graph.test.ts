import { describe, expect, it } from "vitest";
import { loadMeta } from "./loader.js";
import { buildWorkflowGraph } from "./workflow-graph.js";
import { renderWorkflowGraphAscii } from "./workflow-graph-ascii.js";
import { renderWorkflowGraphDot } from "./workflow-graph-dot.js";

function source(opts: {
  readonly name: string;
  readonly description: string;
  readonly harness: string;
  readonly phases?: readonly unknown[];
  readonly output?: string;
  readonly body: string;
}): string {
  const meta = {
    name: opts.name,
    description: opts.description,
    harness: opts.harness,
    ...(opts.phases ? { phases: opts.phases } : {}),
    ...(opts.output ? { output: opts.output } : {}),
  };
  return `export default defineWorkflow(\n${JSON.stringify(meta, null, 2).replace(/^/gm, "  ")}\n);`.replace(
    "  }\n);",
    `  ,\n  async run() {\n${opts.body}\n  }\n}\n);`,
  );
}

function graph(workflowSource: string) {
  return buildWorkflowGraph({
    file: "/wf.ts",
    source: workflowSource,
    meta: loadMeta(workflowSource),
  });
}

describe("workflow graph extraction", () => {
  it("includes metadata phases, agents, questions, nested workflows, and output", () => {
    const workflowSource = source({
      name: "review-pr",
      description: "Review a pull request",
      harness: "claude",
      phases: [{ title: "Plan" }, { title: "Review" }, { title: "Summarize" }],
      output: "review-output",
      body: `
phase("Plan");
const plan = await agent("Make review plan", { label: "plan" });
phase("Review");
await workflow("release-notes", { args: { version: "1" } });
phase("Summarize");
const deploy = await askUserQuestion({ key: "deploy", question: "Deploy this?" });
return { plan, deploy };
`,
    });

    const g = graph(workflowSource);

    expect(g.workflow.name).toBe("review-pr");
    expect(g.nodes.filter((n) => n.type === "phase").map((n) => n.label)).toEqual([
      "Plan",
      "Review",
      "Summarize",
    ]);
    expect(g.nodes).toContainEqual({
      type: "agent",
      id: "agent_plan",
      label: "plan",
      hasSchema: false,
    });
    expect(g.nodes).toContainEqual({
      type: "nested-workflow",
      id: "nested_release_notes",
      label: "nested workflow: release-notes",
      target: "release-notes",
    });
    expect(g.nodes).toContainEqual({
      type: "question",
      id: "question_deploy",
      label: "deploy",
      key: "deploy",
    });
    expect(g.nodes).toContainEqual({ type: "output", id: "output", label: "review-output" });
    expect(g.edges).toContainEqual({ from: "phase_plan", to: "agent_plan", kind: "sequence" });
    expect(g.edges).toContainEqual({ from: "question_deploy", to: "output", kind: "returns" });
  });

  it("extracts parallel branches with an explicit join before continuation", () => {
    const workflowSource = source({
      name: "parallel-review",
      description: "parallel",
      harness: "raw-api",
      body: `
const reviews = await parallel([
  () => agent("Security review", { label: "security", schema: z.object({ ok: z.boolean() }) }),
  () => agent("UX review", { label: "ux" }),
]);
await agent("Summarize", { label: "summary" });
return { reviews };
`,
    });

    const g = graph(workflowSource);

    expect(g.nodes).toContainEqual({ type: "parallel", id: "parallel", label: "parallel" });
    expect(g.nodes).toContainEqual({ type: "join", id: "parallel_join", label: "join" });
    expect(g.nodes).toContainEqual({
      type: "agent",
      id: "agent_security",
      label: "security",
      hasSchema: true,
    });
    expect(g.nodes).toContainEqual({
      type: "agent",
      id: "agent_ux",
      label: "ux",
      hasSchema: false,
    });
    expect(g.edges).toContainEqual({
      from: "parallel",
      to: "agent_security",
      kind: "parallel-branch",
    });
    expect(g.edges).toContainEqual({ from: "parallel", to: "agent_ux", kind: "parallel-branch" });
    expect(g.edges).toContainEqual({
      from: "agent_security",
      to: "parallel_join",
      kind: "sequence",
    });
    expect(g.edges).toContainEqual({ from: "agent_ux", to: "parallel_join", kind: "sequence" });
    expect(g.edges).toContainEqual({
      from: "parallel_join",
      to: "agent_summary",
      kind: "sequence",
    });
  });

  it("extracts agent calls inside pipeline stages", () => {
    const workflowSource = source({
      name: "pipeline-review",
      description: "pipeline",
      harness: "claude",
      body: `
await pipeline(
  ["a"],
  async (item) => agent(\`Review \${item}\`, { label: "review item" }),
  async function summarize(prev) { return agent("Summarize", { label: "summarize" }); },
);
`,
    });

    const g = graph(workflowSource);

    expect(g.nodes).toContainEqual({ type: "pipeline", id: "pipeline", label: "pipeline" });
    expect(g.nodes).toContainEqual({ type: "stage", id: "stage_stage_1", label: "stage: stage 1" });
    expect(g.nodes).toContainEqual({
      type: "stage",
      id: "stage_summarize",
      label: "stage: summarize",
    });
    expect(g.nodes).toContainEqual({
      type: "agent",
      id: "agent_review_item",
      label: "review item",
      hasSchema: false,
    });
    expect(g.nodes).toContainEqual({
      type: "agent",
      id: "agent_summarize",
      label: "summarize",
      hasSchema: false,
    });
    expect(g.edges).toContainEqual({
      from: "stage_stage_1",
      to: "agent_review_item",
      kind: "contains",
    });
    expect(g.edges).toContainEqual({
      from: "agent_review_item",
      to: "stage_summarize",
      kind: "pipeline-stage",
    });
  });

  it("represents dynamic code with warnings instead of failing", () => {
    const workflowSource = source({
      name: "dynamic-review",
      description: "dynamic",
      harness: "codex",
      body: `
for (const item of args.items) {
  await agent(\`review \${item}\`);
}
await parallel(args.branches);
await workflow(args.target);
`,
    });

    const g = graph(workflowSource);

    expect(g.nodes.some((n) => n.type === "dynamic" && n.label === "dynamic loop")).toBe(true);
    expect(g.nodes.some((n) => n.type === "agent" && n.label === "review ${...}")).toBe(true);
    expect(g.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining([
        "DynamicLoop",
        "DynamicAgentPrompt",
        "DynamicParallel",
        "UnknownNestedWorkflow",
      ]),
    );
  });

  it("renders ASCII as a terminal-friendly tree", () => {
    const workflowSource = source({
      name: "ascii-haiku",
      description: "ascii",
      harness: "copilot",
      phases: ["Write"],
      body: `phase("Write");
await agent("Write a haiku", { label: "haiku-writer" });`,
    });

    const ascii = renderWorkflowGraphAscii(graph(workflowSource));

    expect(ascii).toBe(`Workflow: ascii-haiku (copilot)

◎ ascii-haiku
└── [phase] Write
    └── 🤖 haiku-writer
`);
  });

  it("surfaces approximation warnings in ASCII output", () => {
    const workflowSource = source({
      name: "ascii-warning",
      description: "ascii",
      harness: "claude",
      body: `await parallel(args.branches);`,
    });

    const ascii = renderWorkflowGraphAscii(graph(workflowSource));

    expect(ascii).toContain("Warnings:");
    expect(ascii).toContain("DynamicParallel");
  });

  it("renders DOT with workflow styling", () => {
    const workflowSource = source({
      name: "dotty",
      description: "dot",
      harness: "claude",
      phases: ["Plan"],
      body: `await agent("Make a plan", { label: "planner" });`,
    });

    const dot = renderWorkflowGraphDot(graph(workflowSource));

    expect(dot).toContain("digraph workflow");
    expect(dot).toContain('root [label="dotty", shape="doublecircle"');
    expect(dot).toContain('agent_planner [label="agent: planner"');
  });

  it("surfaces approximation warnings in DOT output", () => {
    const workflowSource = source({
      name: "dot-warning",
      description: "dot",
      harness: "claude",
      body: `await parallel(args.branches);`,
    });

    const dot = renderWorkflowGraphDot(graph(workflowSource));

    expect(dot).toContain("graph is approximate");
    expect(dot).toContain("DynamicParallel");
  });

  it("can omit locations when graphing generated bundled source", () => {
    const workflowSource = source({
      name: "generated-warning",
      description: "generated",
      harness: "claude",
      body: `await workflow(args.target);`,
    });

    const g = buildWorkflowGraph({
      file: "/wf.ts",
      source: workflowSource,
      meta: loadMeta(workflowSource),
      includeLocations: false,
    });

    expect(g.warnings[0]).toMatchObject({ code: "UnknownNestedWorkflow" });
    expect(g.warnings[0]?.location).toBeUndefined();
  });
});
