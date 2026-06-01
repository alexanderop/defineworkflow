// doc-gen — generate or refresh a README section / docstrings, persisted as an artifact.
//
// Harness: claude (auto-adapted on `workflow init` to whatever you have installed).
// Args:    {"target":"README.md","section":"Usage"}  — what to (re)generate.
//
// `output` makes the run persist its return value: result.json plus each top-level string field
// as its own file (here `markdown.md`), so the generated docs land on disk automatically.
//
// Try it free (no tokens):  workflow run doc-gen.workflow.ts --mock
// Run for real:             workflow run doc-gen.workflow.ts \
//                             --args '{"target":"README.md","section":"Usage"}' --yes

import { agent, args, defineWorkflow, log, z } from "defineworkflow";

const DocSchema = z.object({
  markdown: z.string().describe("the generated documentation section, as Markdown"),
  notes: z.string().describe("what was covered and any assumptions made"),
});

export default defineWorkflow({
  name: "doc-gen",
  description: "Generate/refresh a README section or docstrings",
  whenToUse: "When docs have drifted from the code and you want a fresh, accurate section.",
  harness: "claude",
  output: "./docs-out",
  phases: [{ title: "Generate" }],

  async run() {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the immutable CLI args payload
    const a = (args ?? {}) as { target?: string; section?: string };
    const target = a.target ?? "README.md";
    const section = a.section ?? "Usage";
    log(`generating the "${section}" section for ${target}`);

    const doc = await agent(
      `Read the relevant source in this repository and write an accurate, concise "${section}" ` +
        `section for "${target}". Use real APIs and examples from the code — do not invent them. ` +
        "Return the section as Markdown in the `markdown` field.",
      { label: "doc-writer", phase: "Generate", schema: DocSchema },
    );

    return doc;
  },
});
