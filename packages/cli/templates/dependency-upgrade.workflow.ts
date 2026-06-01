// dependency-upgrade — bump a dependency, fix the breakages, summarize changelog risk.
//
// Harness: claude (auto-adapted on `workflow init` to whatever you have installed).
// Args:    {"package":"left-pad","version":"latest"}
//
// Uses phase() staging, budget narration, and a try/finally so the summary always runs —
// even if the fix step throws.
//
// Try it free (no tokens):  workflow run dependency-upgrade.workflow.ts --mock
// Run for real:             workflow run dependency-upgrade.workflow.ts \
//                             --args '{"package":"zod","version":"latest"}' --yes

import { agent, args, budget, defineWorkflow, log, phase, z } from "defineworkflow";

const BumpSchema = z.object({
  from: z.string().describe("the previous version"),
  to: z.string().describe("the version installed"),
  installOutput: z.string().describe("summarized output of the install command"),
});
const FixSchema = z.object({
  filesChanged: z.array(z.string()),
  buildPasses: z.boolean().describe("true if the build/typecheck passes after the fixes"),
  notes: z.string(),
});
const RiskSchema = z.object({
  breakingChanges: z.array(z.string()).describe("notable breaking changes from the changelog"),
  risk: z.enum(["low", "medium", "high"]),
  summary: z.string(),
});

export default defineWorkflow({
  name: "dependency-upgrade",
  description: "Bump a dep, fix breakages, summarize changelog risk",
  whenToUse: "When upgrading a dependency and you want breakages fixed and the risk summarized.",
  harness: "claude",
  phases: [{ title: "Bump" }, { title: "Fix" }, { title: "Summarize" }],

  async run() {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the immutable CLI args payload
    const a = (args ?? {}) as { package?: string; version?: string };
    const pkg = a.package ?? "left-pad";
    const version = a.version ?? "latest";

    try {
      phase("Bump");
      log(`upgrading ${pkg} → ${version}`);
      const bump = await agent(
        `Upgrade the dependency "${pkg}" to "${version}" in this project using its package manager ` +
          "(detect npm/pnpm/yarn from the lockfile). Run the install and report the before/after versions.",
        { label: "bump", phase: "Bump", schema: BumpSchema },
      );

      phase("Fix");
      if (budget.remaining() !== Infinity) log(`budget remaining: ${budget.remaining()}`);
      const fix = await agent(
        `The dependency "${pkg}" was upgraded from ${bump.from} to ${bump.to}. Run the build/typecheck, ` +
          "fix any breakages caused by the upgrade, and re-run until it passes (or report what's blocking).",
        { label: "fix", phase: "Fix", schema: FixSchema },
      );

      return { package: pkg, bump, fix };
    } finally {
      // Always summarize the changelog risk, even if the fix step above threw.
      phase("Summarize");
      const risk = await agent(
        `Summarize the changelog/release-notes risk of upgrading "${pkg}" to "${version}". ` +
          "List notable breaking changes and rate the overall risk.",
        { label: "summarize", phase: "Summarize", schema: RiskSchema },
      );
      log(`risk: ${risk.risk}`);
    }
  },
});
