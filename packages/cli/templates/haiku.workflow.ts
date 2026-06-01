// haiku — the hello-world workflow: one agent() call returning structured output.
//
// Harness: claude (auto-adapted on `workflow init` to whatever you have installed).
// Args/env: none.
//
// Try it free (no tokens):  workflow run haiku.workflow.ts --mock
// Run for real:             workflow run haiku.workflow.ts --yes

import { agent, defineWorkflow, log, phase, z } from "defineworkflow";

export default defineWorkflow({
  name: "haiku",
  description: "Minimal single-agent workflow",
  whenToUse: "Your first workflow — learn agent() and structured (zod) output in one screen.",
  harness: "claude",
  phases: [{ title: "Write" }],

  async run() {
    phase("Write");
    log("asking the agent for a haiku…");

    const { haiku } = await agent(
      "Write a haiku about durable, crash-safe workflows. Return it in the `haiku` field as a " +
        "single string with the three lines separated by newlines.",
      {
        label: "haiku-writer",
        phase: "Write",
        schema: z.object({
          haiku: z.string().describe("The full haiku, three lines separated by newlines"),
        }),
      },
    );

    return { haiku };
  },
});
