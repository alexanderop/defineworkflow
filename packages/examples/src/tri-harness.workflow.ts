// Per-agent harness smoke test: ONE workflow that dispatches to all three coding
// CLIs — claude, codex, and copilot — and then judges their answers with claude.
//
// This is the quickest way to verify that per-call `agent({ adapter })` routing
// works end-to-end: each contestant runs on a different harness, so if all three
// `solutions` come back populated, every adapter spawned and returned schema-valid
// output. The `meta.harness` ("claude") is only the run DEFAULT — the contestants
// override it per call; the judge uses the default.
//
// Run it from the repo root:
//   pnpm tri-harness
// …or directly:
//   workflow run packages/examples/src/tri-harness.workflow.ts --yes
//   workflow run packages/examples/src/tri-harness.workflow.ts --mock   # no agents/tokens, just control flow
//
// First confirm all three CLIs are installed, or the missing ones silently fall
// back to the run default (claude) and you won't actually be testing them:
//   workflow adapters
//
// Per-call adapter resolution is best-effort: an adapter that isn't installed/
// buildable falls back to `meta.harness` rather than erroring (see runtime.ts).

import { agent, defineWorkflow, log, parallel, phase, z } from "defineworkflow";

export default defineWorkflow({
  name: "tri-harness",
  description:
    "Run the same tiny coding task on claude, codex, and copilot, then judge the results",
  harness: "claude", // run default + the judge; contestants override this per call
  phases: [
    { title: "Implement", detail: "each harness solves the same task in parallel" },
    { title: "Judge", detail: "claude compares the three solutions" },
  ],

  async run() {
    const Solution = z.object({
      code: z.string().describe("A single TypeScript function, no markdown fences, no prose."),
      note: z.string().describe("One sentence explaining the approach."),
    });
    const Verdict = z.object({
      winner: z
        .enum(["claude", "codex", "copilot"])
        .describe("Which harness produced the best solution."),
      reason: z.string().describe("One sentence justifying the choice."),
    });

    // The harnesses to race. Each is a valid AgentOptions.adapter id.
    const HARNESSES = ["claude", "codex", "copilot"] as const;
    const TASK =
      "Write a TypeScript function `isPalindrome(s: string): boolean` that ignores case and " +
      "non-alphanumeric characters. Return ONLY the function source in `code` and a one-sentence " +
      "explanation in `note`. Answer from your own knowledge — no tools, no web.";

    phase("Implement");
    log(`racing ${HARNESSES.length} harnesses: ${HARNESSES.join(", ")}`);

    const results = await parallel(
      HARNESSES.map(
        (harness) => () =>
          agent(TASK, {
            adapter: harness,
            label: `impl:${harness}`,
            phase: "Implement",
            schema: Solution,
          }),
      ),
    );

    // Pair each result back with the harness that produced it; drop any that failed.
    const solutions = HARNESSES.map((harness, i) => ({
      harness,
      ...(results[i] ?? undefined),
    })).filter(
      (s): s is { harness: (typeof HARNESSES)[number]; code: string; note: string } =>
        typeof s.code === "string" && s.code.trim().length > 0,
    );
    log(`collected ${solutions.length}/${HARNESSES.length} solutions`);

    phase("Judge");
    const ballot = solutions.map((s) => `## ${s.harness}\n${s.note}\n\n${s.code}`).join("\n\n");
    const verdict = await agent(
      `Three coding agents solved the same task. Pick the best solution.\n\n${ballot}\n\n` +
        `Return the winning harness and a one-sentence reason.`,
      { label: "judge", phase: "Judge", schema: Verdict },
    );

    return {
      ran: HARNESSES,
      succeeded: solutions.map((s) => s.harness),
      winner: verdict.winner,
      reason: verdict.reason,
      solutions,
    };
  },
});
