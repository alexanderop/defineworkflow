// Demonstrates and verifies `isolation: "worktree"`.
//
//   workflow run packages/examples/src/worktree.workflow.ts --yes
//   …or: pnpm --filter @workflow/examples worktree
//
// `isolation: "worktree"` runs an agent inside a detached git worktree created
// under a temp root (`git worktree add --detach`), hands that path to the agent
// as its cwd, and removes the worktree (`git worktree remove --force`) when the
// agent finishes — so changes made inside are DISCARDED. It's pure sandboxing:
// parallel agents can't clobber each other or the main checkout.
//
// Because the worktree is gone after the run, the only way to *see* where an
// agent ran is to have it report its own cwd. This workflow spawns TWO isolated
// agents in parallel and asks each to echo its `pwd` and `git worktree list`.
// We verify it worked by checking that:
//   1. each cwd is a temp worktree path, NOT this repo's root,
//   2. the two cwds differ (agents are isolated from each other),
//   3. `git worktree list` shows a detached/linked worktree, and
//   4. after the run, `git worktree list` from the repo shows nothing leftover.
//
// NOTE: workflow scripts run in a vm sandbox — no imports beyond `defineworkflow`,
// no zod schema, and `defineWorkflow` MUST be the first statement. So the prompt
// builder and parser live inside run().
//
// This spawns real agents and uses tokens.

import { agent, defineWorkflow, log, parallel, phase } from "defineworkflow";

export default defineWorkflow({
  name: "worktree",
  description: "Demonstrate and verify isolation:\"worktree\" — two parallel agents each report their isolated cwd",
  harness: "claude",
  phases: [{ title: "Probe", detail: "two isolated agents report their cwd in parallel" }],

  async run() {
    // These helpers stay inside run() on purpose: the sandbox requires
    // `defineWorkflow` to be the first statement, so nothing may precede it at
    // module scope. (Suppresses unicorn/consistent-function-scoping.)
    // oxlint-disable-next-line consistent-function-scoping
    const probe = (id: string) =>
      `You are running inside some working directory. Use your shell tools to inspect it.\n` +
      `Run exactly these commands and report their RAW output, nothing invented:\n` +
      `  1. pwd\n` +
      `  2. git rev-parse --show-toplevel\n` +
      `  3. git worktree list\n` +
      `Also create a file named "proof-${id}.txt" in the current directory (e.g. \`echo ${id} > proof-${id}.txt\`).\n` +
      `Then output ONLY a block in EXACTLY this format (no markdown fences, no commentary):\n` +
      `CWD: <output of pwd>\n` +
      `TOPLEVEL: <output of git rev-parse --show-toplevel>\n` +
      `WORKTREES:\n` +
      `<full output of git worktree list>`;

    // Pull the `CWD:` line out of an agent's free-text report.
    // oxlint-disable-next-line consistent-function-scoping
    const extractCwd = (report: unknown): string | null => {
      if (typeof report !== "string") return null;
      const line = report.split("\n").find((l) => l.trim().startsWith("CWD:"));
      return line ? line.slice(line.indexOf("CWD:") + 4).trim() : null;
    };

    phase("Probe");
    log("spawning two worktree-isolated agents in parallel…");

    const [reportA, reportB] = await parallel([
      () => agent(probe("a"), { label: "probe:a", phase: "Probe", isolation: "worktree" }),
      () => agent(probe("b"), { label: "probe:b", phase: "Probe", isolation: "worktree" }),
    ]);

    const cwdA = extractCwd(reportA);
    const cwdB = extractCwd(reportB);
    const distinct = cwdA !== null && cwdB !== null && cwdA !== cwdB;

    log(distinct ? `two distinct worktrees: ${cwdA}  |  ${cwdB}` : "could not confirm two distinct worktrees from output");

    return {
      cwdA,
      cwdB,
      distinctWorktrees: distinct,
      reportA,
      reportB,
    };
  },
});
