// A smoke test for askUserQuestion() — deterministic human-in-the-loop, then a real agent() call
// that acts on the answer.
//
// The shape is: ask the human what to write about, then hand that answer to an agent and let it do
// the work. The answer is journaled, so a resumed run never re-asks; the agent result is journaled
// too, so a replay never re-invokes the model.
//
// Run it from the repo root (the question is answered by you, interactively):
//   pnpm run question
//
// …or from this package / the CLI directly:
//   pnpm --filter @workflow/examples question
//   workflow run packages/examples/src/question.workflow.ts --yes
//
// Add --mock to fabricate the agent result (no harness, no tokens) while still answering the prompt
// yourself — handy for iterating on the control flow:
//   workflow run packages/examples/src/question.workflow.ts --mock
//
// In a non-interactive context (no TTY / CI) the question falls back to its `default`, so this still
// completes headlessly — or supply the answer up front:
//   workflow run packages/examples/src/question.workflow.ts --mock \
//     --answers '{"topic":"the ocean"}'

import { agent, askUserQuestion, defineWorkflow, log, phase, z } from "defineworkflow";

export default defineWorkflow({
  name: "question",
  description: "Ask the human a question, then have an agent act on the answer",
  harness: "claude",
  phases: [{ title: "Ask" }, { title: "Write" }],

  async run() {
    phase("Ask");

    // Choices plus an "Other → type your own" escape hatch, with a headless default.
    const topic = await askUserQuestion({
      key: "topic",
      question: "## What should the haiku be about?\nPick a topic, or choose Other to type your own.",
      choices: ["durable workflows", "the ocean", "a sleeping cat"],
      allowOther: true,
      default: "durable workflows",
    });
    log(`topic: ${topic}`);

    phase("Write");
    log("asking the agent for a haiku…");

    // Hand the human's answer to the agent. The zod schema makes `haiku` typed as `string`
    // (instead of `unknown`) and validates the model's output at run time. Name the field in the
    // prompt and describe it on the schema so the model returns structured output instead of prose
    // (a bare "Write a haiku" invites plain text that never satisfies the schema).
    const { haiku } = await agent(
      `Write a haiku about ${topic}. Return it in the "haiku" field as a single string (newlines between the three lines).`,
      {
        label: "haiku-writer",
        phase: "Write",
        schema: z.object({
          haiku: z.string().describe("The full haiku, three lines separated by newlines"),
        }),
      },
    );

    return { topic, haiku };
  },
});
