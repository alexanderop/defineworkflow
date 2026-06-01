// incident-triage — triage a stack trace, then ask the human which lead to pursue (HITL).
//
// Harness: claude (auto-adapted on `workflow init` to whatever you have installed).
// Args:    {"trace":"<stack trace text>"}
//
// askUserQuestion() is deterministic human-in-the-loop: the answer is journaled, so a resumed run
// never re-asks. Headless? Supply the choice up front with --answers, or it falls back to `default`.
//
// Try it free (no tokens):  workflow run incident-triage.workflow.ts --mock
// Headless (no prompt):     workflow run incident-triage.workflow.ts --mock \
//                             --answers '{"lead":"most-likely"}'

import { agent, args, askUserQuestion, defineWorkflow, log, phase, z } from "defineworkflow";

const TriageSchema = z.object({
  summary: z.string().describe("what the trace indicates, in one paragraph"),
  leads: z
    .array(z.object({ hypothesis: z.string(), confidence: z.enum(["high", "medium", "low"]) }))
    .describe("candidate root-cause hypotheses, most likely first"),
});
const PlanSchema = z.object({
  steps: z.array(z.string()).describe("concrete investigation/fix steps for the chosen lead"),
  filesToInspect: z.array(z.string()),
});

export default defineWorkflow({
  name: "incident-triage",
  description: "Triage a stack trace; asks you which lead to pursue",
  whenToUse: "When you have a stack trace and want hypotheses, then to steer which one to chase.",
  harness: "claude",
  phases: [{ title: "Triage" }, { title: "Decide" }, { title: "Plan" }],

  async run() {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the immutable CLI args payload
    const a = (args ?? {}) as { trace?: string };
    const trace = a.trace ?? "TypeError: Cannot read properties of undefined (reading 'id')";

    phase("Triage");
    const triage = await agent(
      `Triage this error/stack trace and propose ranked root-cause hypotheses:\n\n${trace}`,
      { label: "triage", phase: "Triage", schema: TriageSchema },
    );
    log(`found ${triage.leads.length} leads`);

    phase("Decide");
    // Ask the human which lead to pursue. The choices double as the headless --answers keys.
    const lead = await askUserQuestion({
      key: "lead",
      question:
        "## Which lead should I pursue?\nPick the hypothesis to investigate, or choose Other to describe your own.",
      choices: ["most-likely", "second", "let-me-describe"],
      allowOther: true,
      default: "most-likely",
    });
    const chosen =
      lead === "most-likely"
        ? (triage.leads[0]?.hypothesis ?? lead)
        : lead === "second"
          ? (triage.leads[1]?.hypothesis ?? lead)
          : lead;
    log(`pursuing: ${chosen}`);

    phase("Plan");
    const plan = await agent(
      `Produce a concrete investigation plan for this root-cause hypothesis: "${chosen}". ` +
        "Inspect the relevant code in the repo and list the steps and files to check.",
      { label: "plan", phase: "Plan", schema: PlanSchema },
    );

    return { triage, chosen, plan };
  },
});
