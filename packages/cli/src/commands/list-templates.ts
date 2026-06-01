import type { Immutable } from "@workflow/core";
import type { AppDeps } from "../app.js";
import { loadTemplateIndex, type TemplateEntry } from "../templates.js";

type Entry = Immutable<TemplateEntry>;
const star = (t: Entry): string => (t.recommended ? `${t.name} ★` : t.name);
const agentsOf = (t: Entry): string => (t.agents === undefined ? "-" : String(t.agents));

/**
 * List the bundled `init` templates. The gallery-as-a-command: works offline, ships with the
 * binary. `--json` is the machine-readable surface a coding agent uses to discover templates.
 * All data comes from `index.json` — no workflow file is read or executed.
 */
export function listTemplatesCommand(
  args: { readonly json: boolean },
  deps: Pick<AppDeps, "env" | "io" | "ui">,
): number {
  const indexResult = loadTemplateIndex(deps);
  if (indexResult.isErr()) {
    deps.ui.print(`error: ${indexResult.error}\n`);
    return 1;
  }
  const templates = indexResult.value.templates;

  if (args.json) {
    deps.ui.print(`${JSON.stringify(templates, null, 2)}\n`);
    return 0;
  }

  deps.ui.print("Available templates:\n\n");
  deps.ui.print(
    `${"NAME".padEnd(20)}${"HARNESS".padEnd(10)}${"AGENTS".padEnd(8)}${"COMPLEXITY".padEnd(14)}DESCRIPTION\n`,
  );
  for (const t of templates) {
    deps.ui.print(
      `${star(t).padEnd(20)}${t.harness.padEnd(10)}${agentsOf(t).padEnd(8)}${(t.complexity ?? "-").padEnd(14)}${t.description}\n`,
    );
  }
  const first = templates[0]?.name ?? "<template>";
  deps.ui.print(`\n  Scaffold one:   workflow init ${first}\n`);
  deps.ui.print("  Machine output: workflow list-templates --json\n");
  return 0;
}
