// codebase-migration — a mechanical rename/migration fanned out across files with parallel().
//
// Harness: codex (auto-adapted on `workflow init` to whatever you have installed).
// Args:    {"from":"oldName","to":"newName","files":["a.ts","b.ts"]}
//
// parallel() runs one agent per file concurrently (fan-out), then we fan-in the results.
// budget.remaining() is used to narrate how much token headroom is left as the fan-out runs.
//
// Try it free (no tokens):  workflow run codebase-migration.workflow.ts --mock
// Run for real:             workflow run codebase-migration.workflow.ts \
//                             --args '{"from":"getUser","to":"fetchUser","files":["src/a.ts"]}' --yes

import { agent, args, budget, defineWorkflow, log, parallel, phase, z } from "defineworkflow";

const FileResult = z.object({
  file: z.string(),
  changed: z.boolean().describe("true if the file was modified"),
  edits: z.number().int().describe("how many occurrences were rewritten"),
  notes: z.string().describe("anything risky or skipped, e.g. a string literal left untouched"),
});

export default defineWorkflow({
  name: "codebase-migration",
  description: "Mechanical rename/migration across files (parallel)",
  whenToUse: "When a rename or API migration spans many files and you want it done in parallel.",
  harness: "codex",
  phases: [{ title: "Migrate" }],

  async run() {
    const a =
      // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the immutable CLI args payload
      (args ?? {}) as { from?: string; to?: string; files?: readonly string[] };
    const from = a.from ?? "oldName";
    const to = a.to ?? "newName";
    const files = a.files ?? ["src/index.ts"];

    phase("Migrate");
    log(`renaming "${from}" → "${to}" across ${files.length} file(s)`);
    if (budget.remaining() !== Infinity) log(`token budget remaining: ${budget.remaining()}`);

    // Fan-out: one agent per file, all in flight at once. Each returns a structured report.
    const results = await parallel(
      files.map(
        (file) => () =>
          agent(
            `In the file "${file}", rename every reference to the identifier "${from}" to "${to}". ` +
              "Rewrite declarations, imports/exports, and call sites — but NOT unrelated substrings " +
              "or string literals that merely contain the text. Edit the file in place and report " +
              "how many occurrences you changed.",
            { label: `migrate:${file}`, phase: "Migrate", schema: FileResult },
          ),
      ),
    );

    // Fan-in: drop any file whose agent failed (parallel yields null for those).
    const done = results.filter((r): r is NonNullable<typeof r> => r !== null);
    const totalEdits = done.reduce((sum, r) => sum + r.edits, 0);
    log(`migrated ${done.length}/${files.length} files, ${totalEdits} edits`);

    return { from, to, files: done, totalEdits };
  },
});
