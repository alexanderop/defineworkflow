// Verifies the zod authoring path end-to-end: `z` is injected into the sandbox, the
// runtime converts the zod schema to JSON Schema, and (under --mock) the fabricated data
// validates against it. `out` is fully typed as { title: string; impact: "high" | ... }.
//
//   workflow run packages/examples/src/zod-mock.workflow.ts --mock

import { agent, defineWorkflow, log, z } from "defineworkflow";

export default defineWorkflow({
  name: "zod-mock",
  description: "Tiny zod-schema workflow for verifying the authoring path",
  harness: "claude",
  phases: [{ title: "Draft" }],
  async run() {
    log("asking for a structured headline…");
    const out = await agent("Invent a fun dev-tool headline.", {
      label: "headline",
      model: "haiku",
      schema: z.object({
        title: z.string(),
        impact: z.enum(["high", "medium", "low"]),
        tags: z.array(z.string()),
      }),
    });
    // out is typed: { title: string; impact: "high" | "medium" | "low"; tags: string[] }
    return { title: out.title, impact: out.impact, tagCount: out.tags.length };
  },
});
