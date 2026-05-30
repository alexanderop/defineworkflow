// A fast smoke test of the workflow engine: parallel agents + multi-phase, using
// plain-text agents (no schema) so it's quick and deterministic.
//
//   workflow run packages/examples/src/smoke.workflow.ts --yes
//
// If this returns a populated `report`, the runtime, adapter spawn (stdin closed),
// YOLO permissions, parallel(), phases, and journaling are all working. It does NOT
// exercise `--json-schema` (claude's structured-output is unreliable headless — see
// the claude adapter for the coercion/retry TODO).
//
// `defineWorkflow` makes `harness` type-safe: editors autocomplete
// "claude" | "codex" | "copilot" | "raw-api", and `tsc` rejects invalid values.

import { agent, defineWorkflow, log, parallel, phase } from "defineworkflow";

export default defineWorkflow({
  name: "smoke",
  description: "Fast end-to-end smoke test of the workflow engine (parallel + phases, no schema)",
  harness: "claude",
  phases: [
    { title: "Gather", detail: "three quick agents answer in parallel" },
    { title: "Summarize", detail: "one agent combines the answers" },
  ],

  async run() {
    const TOPICS = ["the Vue.js reactivity system", "the Nuxt framework", "the Vite build tool"];

    phase("Gather");
    log(`asking ${TOPICS.length} agents in parallel…`);

    const answers = await parallel(
      TOPICS.map((topic) => () =>
        agent(
          `In ONE sentence, describe "${topic}". Answer from your own knowledge — no tools, no web. ` +
            `Output only the sentence, nothing else.`,
          { label: `gather:${topic}`, phase: "Gather" },
        ),
      ),
    );

    const got = answers.filter((a): a is string => typeof a === "string" && a.trim().length > 0);
    log(`collected ${got.length}/${TOPICS.length} answers`);

    phase("Summarize");
    const report = (await agent(
      `Combine these one-line descriptions into a tight 3-bullet markdown list:\n\n${got.join("\n")}\n\nOutput only the markdown.`,
      { label: "summarize", phase: "Summarize" },
    )) as string;

    return { report, gathered: got.length, expected: TOPICS.length };
  },
});
