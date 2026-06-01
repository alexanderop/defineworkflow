// test-backfill — generate missing tests for a target module, via a 3-stage pipeline().
//
// Harness: codex (auto-adapted on `workflow init` to whatever you have installed).
// Args:    {"target":"path/to/module.ts"}  — the module to backfill tests for.
//
// pipeline() threads each stage's output into the next: analyze → write → self-check.
//
// Try it free (no tokens):  workflow run test-backfill.workflow.ts --mock
// Run for real:             workflow run test-backfill.workflow.ts \
//                             --args '{"target":"src/util.ts"}' --yes

import { agent, args, defineWorkflow, log, pipeline, z } from "defineworkflow";

const AnalysisSchema = z.object({
  exports: z.array(z.string()).describe("public functions/classes that need coverage"),
  gaps: z.array(z.string()).describe("untested branches, edge cases, and error paths"),
  testCommand: z.string().describe("the command this project uses to run tests"),
});
const WriteSchema = z.object({
  testFile: z.string().describe("path of the test file created or extended"),
  casesAdded: z.array(z.string()).describe("one line per test case added"),
});
const CheckSchema = z.object({
  ran: z.boolean().describe("true if the tests were actually executed"),
  passed: z.boolean().describe("true if the new tests pass"),
  output: z.string().describe("the summarized test runner output"),
});

export default defineWorkflow({
  name: "test-backfill",
  description: "Generate missing tests for a target module",
  whenToUse: "When a module is under-tested and you want coverage filled in test-first.",
  harness: "codex",
  phases: [{ title: "Analyze" }, { title: "Write" }, { title: "Self-check" }],

  async run() {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the immutable CLI args payload
    const a = (args ?? {}) as { target?: string };
    const target = a.target ?? "src/index.ts";
    log(`backfilling tests for: ${target}`);

    const [result] = await pipeline(
      [target],

      // Stage 1 — Analyze the module's surface and coverage gaps.
      (_prev, mod) =>
        agent(
          `Read "${mod}" and identify its public surface and the behaviors that lack tests. ` +
            "Report the project's existing test command (inspect package.json / config).",
          { label: "analyze", phase: "Analyze", schema: AnalysisSchema },
        ).then((analysis) => ({ mod, analysis })),

      // Stage 2 — Write the missing tests next to the module.
      (prev) =>
        agent(
          `Write tests for "${prev.mod}" covering these gaps:\n- ${prev.analysis.gaps.join("\n- ")}\n\n` +
            "Follow the project's existing test conventions and place the file where the project " +
            "expects tests. Create or extend the test file on disk.",
          { label: "write", phase: "Write", schema: WriteSchema },
        ).then((written) => ({ ...prev, written })),

      // Stage 3 — Run the tests and confirm they pass.
      (prev) =>
        agent(
          `Run \`${prev.analysis.testCommand}\` and report whether the tests in ` +
            `"${prev.written.testFile}" pass. Summarize the output; do not edit the tests to force a pass.`,
          { label: "self-check", phase: "Self-check", schema: CheckSchema },
        ).then((check) => ({ ...prev, check })),
    );

    return result;
  },
});
