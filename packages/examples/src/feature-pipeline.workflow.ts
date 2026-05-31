// A full software-delivery pipeline as one workflow, doing REAL work on disk:
// take a rough feature request and drive it PRD → subtasks → (TDD → review →
// refactor) per subtask → integrate → cleanup.
//
// This is a probe: "does a real software pipeline actually work with the workflow
// approach?" So the agents don't just return code as text — they create files,
// write failing tests, RUN them (red → green), review and refactor on disk, all
// inside a throwaway /tmp workspace. A final cleanup step deletes the whole
// workspace, so a run leaves nothing behind in this repo.
//
// Run it (real agents, uses tokens):
//   workflow run packages/examples/src/feature-pipeline.workflow.ts --yes
//   workflow run packages/examples/src/feature-pipeline.workflow.ts \
//     --args '{"feature":"a token-bucket rate limiter","workdir":"/tmp/my-run"}' --yes
//
// Iterate on the control flow with NO agents/tokens spent:
//   workflow run packages/examples/src/feature-pipeline.workflow.ts --mock
//
// How the disk work stays contained:
// - Agents run with full tool access but their cwd defaults to wherever you ran
//   `workflow run` (this repo). To avoid writing here, every agent is told to
//   operate ONLY inside an absolute /tmp workspace, and the final `cleanup` agent
//   `rm -rf`s it. Override the base path with args.workdir.
//
// The build stage uses `pipeline()`, so each subtask flows through TDD → review →
// refactor INDEPENDENTLY — subtask B can be in review while A is still writing
// tests. No barrier between stages; wall-clock ≈ the slowest single subtask chain.
//
// NOTE: the engine requires `defineWorkflow(...)` to be the FIRST runtime statement
// in the file. Only type-only declarations (the `interface`s below, erased at
// compile time) may precede it — so the zod schemas are declared inside `run()`.

import { agent, args, defineWorkflow, log, phase, pipeline, profile, z } from "defineworkflow";

// Type-only shapes (erased by the compiler) used to cast the `unknown` results that
// flow between pipeline stages. These mirror the zod schemas declared inside run().
interface Subtask {
  id: string;
  title: string;
  description: string;
  acceptance: string[];
}
interface TddResult {
  dir: string;
  files: string[];
  testCommand: string;
  redConfirmed: boolean;
  greenConfirmed: boolean;
  notes: string;
}
interface Review {
  verdict: "approve" | "request-changes";
  testsPass: boolean;
  findings: Array<{ severity: "blocker" | "major" | "minor" | "nit"; note: string }>;
  summary: string;
}
interface Refactor {
  changelog: string[];
  testsStillPass: boolean;
}

export default defineWorkflow({
  name: "feature-pipeline",
  description: "Drive a feature from PRD through real on-disk per-subtask TDD, review, refactor, then clean up /tmp",
  whenToUse:
    'Probe whether a real software pipeline works end-to-end with this engine. Pass {"feature":"…","workdir":"/tmp/…"}; with no args it builds a demo rate-limiter under /tmp/workflow-feature-pipeline and deletes it at the end.',
  harness: "claude",
  // No `output`: we deliberately keep everything in /tmp and clean it up. The return
  // value is printed to the terminal on completion.
  phases: [
    { title: "PRD", detail: "expand the request into a structured PRD" },
    { title: "Decompose", detail: "split the PRD into vertical-slice subtasks" },
    { title: "TDD", detail: "per subtask: write failing tests then code, run them (red→green)" },
    { title: "Review", detail: "per subtask: re-run tests + critique the implementation" },
    { title: "Refactor", detail: "per subtask: apply review feedback, keep tests green" },
    { title: "Integrate", detail: "synthesize the delivery report" },
    { title: "Cleanup", detail: "rm -rf the /tmp workspace" },
  ],

  async run() {
    // ── Schemas (zod → inferred types, validated at runtime by the engine) ────────
    const PrdSchema = z.object({
      title: z.string(),
      problem: z.string().describe("the user problem this feature solves"),
      goals: z.array(z.string()),
      nonGoals: z.array(z.string()).describe("explicitly out of scope"),
      requirements: z.array(z.string()).describe("functional requirements, testable"),
      acceptanceCriteria: z.array(z.string()),
    });
    const SubtasksSchema = z.object({
      subtasks: z
        .array(
          z.object({
            id: z.string().describe("short kebab-case id, safe as a folder name, e.g. token-bucket-core"),
            title: z.string(),
            description: z.string().describe("what to build, as a vertical slice"),
            acceptance: z.array(z.string()).describe("how we know this subtask is done"),
          }),
        )
        .describe("2-4 independently-implementable vertical slices, ordered by dependency"),
    });
    const TddSchema = z.object({
      dir: z.string().describe("absolute path of the subtask's working directory"),
      files: z.array(z.string()).describe("paths of files created/modified, relative to dir"),
      testCommand: z.string().describe("the exact command used to run the tests"),
      redConfirmed: z.boolean().describe("true if tests were observed FAILING before the implementation"),
      greenConfirmed: z.boolean().describe("true if tests were observed PASSING after the implementation"),
      notes: z.string().describe("design decisions, the final test output summary, assumptions"),
    });
    const ReviewSchema = z.object({
      verdict: z.enum(["approve", "request-changes"]),
      testsPass: z.boolean().describe("true if the reviewer re-ran the tests and they passed"),
      findings: z
        .array(z.object({ severity: z.enum(["blocker", "major", "minor", "nit"]), note: z.string() }))
        .describe("concrete, actionable review comments"),
      summary: z.string(),
    });
    const RefactorSchema = z.object({
      changelog: z.array(z.string()).describe("what changed and why, one line per change"),
      testsStillPass: z.boolean().describe("true if the tests still pass after refactoring"),
    });

    // `args` is `Immutable<JsonValue>` (parsed from the CLI `--args` JSON); narrow it to this run's
    // expected shape. Narrowing via `as` still works; only *mutating* `args` is now a compile error.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the deeply-immutable CLI args payload
    const a = (args ?? {}) as { feature?: string; workdir?: string };
    const feature = a.feature ?? "a token-bucket rate limiter for a public REST API";
    // Absolute, throwaway workspace. Constant by default (the sandbox forbids
    // Date.now()/Math.random(), so we can't synthesize a unique path in-script —
    // pass args.workdir to isolate concurrent runs).
    const workspace = a.workdir ?? "/tmp/workflow-feature-pipeline";

    // The single rule every agent must obey, stated up front and repeated per call.
    const sandboxRule =
      `IMPORTANT: do ALL file work strictly inside "${workspace}" (create it if missing). ` +
      `Never create, edit, or delete files anywhere else. Use absolute paths under that directory.`;
    // Keep the stack dependency-free so tests actually run with no network installs.
    const stackRule =
      `Use Node.js with the built-in test runner ("node --test", no npm install, no external deps). ` +
      `Tests are *.test.mjs; implementation is plain .mjs ES modules.`;

    // A reusable agent profile for the Review stage: bundle the reviewer persona once as
    // `instructions` (prepended to the request prompt) instead of repeating it in the prompt.
    // Profiles are pure, within-file config; the call site stays a normal `agent()` call.
    // NOTE: profile() must be created INSIDE run() — like the zod schemas above — because the
    // engine requires `defineWorkflow(...)` to be the file's first runtime statement.
    const reviewer = profile({
      instructions:
        "You are a meticulous senior software reviewer. Judge correctness, edge cases, and missing " +
        "test coverage above all else; call out blockers plainly and don't rubber-stamp. Ignore pure style nits.",
    });

    try {
      // ── 1. PRD ──────────────────────────────────────────────────────────────────
      phase("PRD");
      log(`writing a PRD for: ${feature}`);
      const prd = await agent(
        `You are a product engineer. Write a concise, implementation-ready PRD for this feature request:\n\n"${feature}"\n\n` +
          `Keep requirements testable and the scope TINY — this is a pipeline probe, not a product. ` +
          `Be specific about non-goals so the build stays small.`,
        { label: "prd", phase: "PRD", schema: PrdSchema },
      );
      log(`PRD "${prd.title}": ${prd.requirements.length} requirements, ${prd.goals.length} goals`);

      // ── 2. Decompose ────────────────────────────────────────────────────────────
      phase("Decompose");
      const { subtasks } = await agent(
        `Break this PRD into 2-4 small, independently-implementable vertical slices, ordered by dependency. ` +
          `Each subtask must be buildable test-first in one pass as a single small module.\n\nPRD:\n${JSON.stringify(prd, null, 2)}`,
        { label: "decompose", phase: "Decompose", schema: SubtasksSchema },
      );
      log(`decomposed into ${subtasks.length} subtasks: ${subtasks.map((s) => s.id).join(", ")}`);

      // ── 3-5. Build each subtask through TDD → Review → Refactor ON DISK ───────────
      // pipeline() runs every subtask through all three stages with NO barrier between
      // them, so a subtask reaches Review the moment its own TDD finishes. Each stage
      // callback gets (prevResult, subtask, i); we pass `phase` explicitly per agent so
      // the progress UI groups correctly even with subtasks in different stages at once.
      const built = await pipeline(
        subtasks,

        // Stage 1 — TDD: real red → green inside the subtask's own /tmp directory.
        (_prev, subtask) => {
          // pipeline() stages receive `unknown`; each schema above guarantees this stage's shape.
          // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the unknown pipeline item
          const s = subtask as Subtask;
          const dir = `${workspace}/${s.id}`;
          return agent(
            `${sandboxRule}\n${stackRule}\n\n` +
              `Implement this subtask TEST-FIRST in the directory "${dir}":\n` +
              `1. Reset the dir: run \`rm -rf ${dir} && mkdir -p ${dir}\`.\n` +
              `2. Write the failing tests first, then RUN them and confirm they FAIL (red).\n` +
              `3. Write the minimal implementation, then RUN the tests and confirm they PASS (green).\n` +
              `Actually execute the commands with your tools — do not just describe them.\n\n` +
              `Subtask: ${s.title}\n${s.description}\nAcceptance:\n- ${s.acceptance.join("\n- ")}\n\n` +
              `Project context (PRD): ${prd.title} — ${prd.problem}\n\n` +
              `Report the real test command, the files you created, and whether red/green were truly observed.`,
            { label: `tdd:${s.id}`, phase: "TDD", schema: TddSchema },
          ).then((tdd) => ({ subtask: s, dir, tdd }));
        },

        // Stage 2 — Review: a fresh agent reads the files and RE-RUNS the tests.
        (prev) => {
          // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the unknown prev-stage result
          const { subtask, dir, tdd } = prev as { subtask: Subtask; dir: string; tdd: TddResult };
          // Apply the `reviewer` profile: its `instructions` persona is prepended to this
          // prompt automatically, so the prompt itself only carries the per-subtask task.
          return agent(
            reviewer,
            `${sandboxRule}\n\n` +
              `The implementation for "${subtask.title}" lives in "${dir}".\n` +
              `1. Read the files there.\n2. Re-run the tests (\`${tdd.testCommand}\`) and record whether they pass.\n` +
              `3. Critique correctness, edge cases, missing tests, and design — be specific and actionable.\n` +
              `Approve only if the tests pass AND it's genuinely ready.\n\n` +
              `Acceptance:\n- ${subtask.acceptance.join("\n- ")}`,
            { label: `review:${subtask.id}`, phase: "Review", schema: ReviewSchema },
          ).then((review) => ({ subtask, dir, tdd, review }));
        },

        // Stage 3 — Refactor: edit the files in place; skip the agent if approved clean.
        (prev) => {
          // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the unknown prev-stage result
          const { subtask, dir, tdd, review } = prev as {
            subtask: Subtask;
            dir: string;
            tdd: TddResult;
            review: Review;
          };
          const actionable = review.findings.filter((f) => f.severity !== "nit");
          if (review.verdict === "approve" && actionable.length === 0) {
            log(`${subtask.id}: approved clean, skipping refactor`);
            return Promise.resolve({
              subtask,
              dir,
              review,
              refactor: {
                changelog: ["no changes — approved as-is"],
                testsStillPass: review.testsPass,
              } satisfies Refactor,
            });
          }
          return agent(
            `${sandboxRule}\n\n` +
              `Apply this review feedback to the code in "${dir}". Address every blocker/major/minor finding and ` +
              `refactor for clarity. After editing, RE-RUN the tests (\`${tdd.testCommand}\`) and confirm they still pass.\n\n` +
              `Findings:\n${review.findings.map((f) => `- [${f.severity}] ${f.note}`).join("\n")}`,
            { label: `refactor:${subtask.id}`, phase: "Refactor", schema: RefactorSchema },
          ).then((refactor) => ({ subtask, dir, review, refactor }));
        },
      );

      // A stage that throws drops its subtask to null — filter those out.
      const done = built.filter(
        (b): b is { subtask: Subtask; dir: string; review: Review; refactor: Refactor } => b !== null,
      );
      log(`built ${done.length}/${subtasks.length} subtasks`);

      // ── 6. Integrate ──────────────────────────────────────────────────────────────
      phase("Integrate");
      const report = await agent(
        `${sandboxRule}\n\n` +
          `The feature "${prd.title}" was built across these subtask directories under "${workspace}". ` +
          `You may read them to verify. Write a concise delivery report in Markdown.\n\n` +
          `PRD:\n${JSON.stringify(prd, null, 2)}\n\n` +
          `Built subtasks:\n` +
          JSON.stringify(
            done.map((d) => ({
              id: d.subtask.id,
              dir: d.dir,
              verdict: d.review.verdict,
              testsPass: d.review.testsPass && d.refactor.testsStillPass,
              changelog: d.refactor.changelog,
            })),
            null,
            2,
          ) +
          `\n\nStructure: a short summary, an "Acceptance Criteria" checklist mapped from the PRD, a per-subtask ` +
          `section (final state + tests pass/fail), and a "Follow-ups / Risks" section. Output ONLY the markdown.`,
        { label: "integrate", phase: "Integrate" },
      );

      return {
        report,
        feature,
        workspace,
        subtaskCount: subtasks.length,
        builtCount: done.length,
        subtasks: done.map((d) => ({
          id: d.subtask.id,
          verdict: d.review.verdict,
          testsPass: d.review.testsPass && d.refactor.testsStillPass,
        })),
      };
    } finally {
      // ── 7. Cleanup ────────────────────────────────────────────────────────────────
      // Runs even if a step above failed, so a run never leaves files in /tmp.
      phase("Cleanup");
      log(`cleaning up workspace ${workspace}`);
      await agent(
        `Delete the throwaway workspace: run \`rm -rf "${workspace}"\` and confirm it is gone ` +
          `(\`ls "${workspace}"\` should report it does not exist). Do not touch anything outside that path. ` +
          `Reply with a one-line confirmation.`,
        { label: "cleanup", phase: "Cleanup" },
      );
    }
  },
});
