import { agent, args, defineWorkflow, log } from "defineworkflow";
import { HaikuSchema } from "./schemas";
import { haikuPrompt } from "./prompts";

export default defineWorkflow({
  name: "multi-file-haiku",
  description: "A minimal multi-file workflow: schema + prompt live in sibling files; the entry reads like a table of contents.",
  harness: "claude",
  phases: [{ title: "Write", detail: "one agent writes a haiku" }],
  async run() {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the immutable CLI args payload
    const topic = ((args ?? {}) as { topic?: string }).topic ?? "a deterministic workflow engine";
    log(`writing a haiku about: ${topic}`);
    const result = await agent(haikuPrompt(topic), { label: "haiku", phase: "Write", schema: HaikuSchema });
    return result;
  },
});
