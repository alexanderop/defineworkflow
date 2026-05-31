import type { WorkflowConfig } from "./config.js";

export type ConsentDecision = "allow" | "deny" | "prompt";

export interface DecideConsentArgs {
  readonly config: WorkflowConfig;
  readonly project: string;
  readonly name: string;
  readonly yes: boolean;
  readonly isTTY: boolean;
  readonly ci: boolean;
}

/** Non-interactive contexts (--yes, no TTY, CI, recorded consent) skip the prompt. */
export function decideConsent(args: DecideConsentArgs): ConsentDecision {
  if (args.yes || !args.isTTY || args.ci) return "allow";
  if (args.config.consents?.[args.project]?.[args.name]) return "allow";
  return "prompt";
}

export interface ConsentIO {
  question(prompt: string): Promise<string>;
  write(text: string): void;
}

export interface WorkflowMetaLike {
  readonly name: string;
  readonly description: string;
  readonly harness?: string | undefined;
  readonly phases?: readonly unknown[] | undefined;
}

export interface ConsentResult {
  readonly allow: boolean;
  readonly remember: boolean;
}

function phaseTitles(meta: WorkflowMetaLike): string {
  const titles = (meta.phases ?? [])
    .map((p) => (typeof p === "object" && p !== null && "title" in p ? String(p.title) : ""))
    .filter(Boolean);
  return titles.length ? titles.join(" · ") : "(no phases declared)";
}

/** Interactive consent prompt (parity with Claude Code's run consent). IO is injected for testing. */
export async function promptConsent(
  meta: WorkflowMetaLike,
  source: string,
  io: ConsentIO,
): Promise<ConsentResult> {
  io.write(`\nWorkflow: ${meta.name}\n`);
  io.write(`  ${meta.description}\n`);
  io.write(`  harness: ${meta.harness ?? "(none declared)"}\n`);
  io.write(`  phases: ${phaseTitles(meta)}\n`);
  io.write(`  ⚠ this will spawn agents and may consume a significant number of tokens.\n`);

  for (;;) {
    const answer = (
      await io.question(
        "Run this workflow? [y]es / [a]lways for this project / [v]iew script / [n]o: ",
      )
    )
      .trim()
      .toLowerCase();
    if (answer === "y" || answer === "yes") return { allow: true, remember: false };
    if (answer === "a" || answer === "always") return { allow: true, remember: true };
    if (answer === "n" || answer === "no" || answer === "")
      return { allow: false, remember: false };
    if (answer === "v" || answer === "view") {
      io.write(`\n${source}\n\n`);
      continue;
    }
    io.write("Please answer y, a, v, or n.\n");
  }
}
