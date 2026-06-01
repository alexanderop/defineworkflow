// multi-file-haiku — the reference layout for a real workflow: a slim entry that reads like a
// table of contents, with the schema and prompt in sibling files imported by relative path.
//
// Harness: claude (auto-adapted on `workflow init` to whatever you have installed).
// Args:    {"topic":"the ocean"}  — what the haiku is about.
//
// The CLI bundles the local imports into one self-contained source before running, so `save`,
// `resume`, and `--detach` all work. Imports are restricted to relative files + "defineworkflow".
//
// Try it free (no tokens):  workflow run multi-file-haiku/haiku.workflow.ts --mock

import { agent, args, defineWorkflow, log } from "defineworkflow";
import { HaikuSchema } from "./schemas";
import { haikuPrompt } from "./prompts";

export default defineWorkflow({
  name: "multi-file-haiku",
  description:
    "A minimal multi-file workflow: schema + prompt live in sibling files; the entry reads like a table of contents.",
  whenToUse: "When you want the canonical folder layout for a workflow split across files.",
  harness: "claude",
  phases: [{ title: "Write", detail: "one agent writes a haiku" }],

  async run() {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the immutable CLI args payload
    const topic = ((args ?? {}) as { topic?: string }).topic ?? "a deterministic workflow engine";
    log(`writing a haiku about: ${topic}`);
    const result = await agent(haikuPrompt(topic), {
      label: "haiku",
      phase: "Write",
      schema: HaikuSchema,
    });
    return result;
  },
});
