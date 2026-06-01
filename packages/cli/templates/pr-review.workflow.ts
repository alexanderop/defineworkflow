// pr-review — review a diff, flag bugs and risks, suggest fixes (structured output).
//
// Harness: claude (auto-adapted on `workflow init` to whatever you have installed).
// Args:    {"diff":"<unified diff text>"}  — falls back to `git diff` against the working tree.
//
// Try it free (no tokens):  workflow run pr-review.workflow.ts --mock
// Run for real:             workflow run pr-review.workflow.ts \
//                             --args '{"diff":"<paste a unified diff>"}' --yes

import { agent, args, defineWorkflow, log, phase, z } from "defineworkflow";

const ReviewSchema = z.object({
  summary: z.string().describe("one-paragraph overview of the change and its risk level"),
  findings: z
    .array(
      z.object({
        severity: z.enum(["blocker", "major", "minor", "nit"]),
        file: z.string().describe("the file the finding is about, if identifiable"),
        note: z.string().describe("what's wrong and why it matters"),
        suggestion: z.string().describe("a concrete fix"),
      }),
    )
    .describe("concrete, actionable review comments, most severe first"),
  verdict: z.enum(["approve", "request-changes"]),
});

export default defineWorkflow({
  name: "pr-review",
  description: "Review a diff, flag bugs and risks, suggest fixes",
  whenToUse: "When you want a structured second opinion on a PR before merge.",
  harness: "claude",
  phases: [{ title: "Review" }],

  async run() {
    phase("Review");

    // `args` is the deeply-immutable CLI `--args` payload; narrow it to this run's expected shape.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the immutable CLI args payload
    const a = (args ?? {}) as { diff?: string };
    const diff = a.diff;

    const task = diff
      ? `Review the following unified diff:\n\n${diff}`
      : "Run `git diff` in the current repository and review the resulting unified diff. " +
        "If there is no diff, run `git diff HEAD~1` instead.";

    log("reviewing the diff…");
    const review = await agent(
      `You are a meticulous senior reviewer. ${task}\n\n` +
        "Judge correctness, edge cases, security, and missing tests above style. " +
        "Return your review in the structured fields — don't rubber-stamp, and don't invent files.",
      { label: "reviewer", phase: "Review", schema: ReviewSchema },
    );

    log(`verdict: ${review.verdict} (${review.findings.length} findings)`);
    return review;
  },
});
