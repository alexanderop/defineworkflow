import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import type { Immutable } from "@workflow/core";
import type { AppDeps } from "../app.js";
import { loadTemplateIndex, type TemplateEntry, type TemplateIndex } from "../templates.js";
import { listTemplatesCommand } from "./list-templates.js";
import { runCommand } from "./run.js";

type Harness = TemplateEntry["harness"];
const HARNESSES: readonly Harness[] = ["claude", "codex", "copilot", "raw-api"];

export interface InitArgs {
  readonly template: string | undefined;
  readonly dir: string | undefined;
  readonly harness: string | undefined;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly run: boolean;
  readonly noRun: boolean;
  readonly mode: "mock" | "real";
  readonly yes: boolean;
}

/** The chosen harness plus a human-readable reason, used for the "created" line + next-steps. */
interface HarnessChoice {
  readonly harness: Harness;
  readonly reason: string;
  /** True when nothing is installed and no API key — surfaces an install hint. */
  readonly noneAvailable: boolean;
}

/** Substitute the entry file's declared `harness` literal. Anchored — only the meta literal matches. */
function rewriteHarness(source: string, harness: Harness): string {
  return source.replace(/(\bharness\s*:\s*)["'][^"']+["']/, `$1"${harness}"`);
}

/** Auto-adapt the template's harness to one actually installed (the #1 new-user error). */
function resolveHarness(
  declared: Harness,
  args: InitArgs,
  deps: AppDeps,
): Result<HarnessChoice, string> {
  if (args.harness !== undefined) {
    // Narrow string → Harness by membership (no cast — AdapterId/HarnessId is this exact union).
    const match = HARNESSES.find((h) => h === args.harness);
    if (match === undefined)
      return err(`invalid --harness '${args.harness}' (expected ${HARNESSES.join(" | ")})`);
    return ok({ harness: match, reason: "from --harness", noneAvailable: false });
  }
  const detected = deps.adapters.detected;
  if (detected.includes(declared))
    return ok({ harness: declared, reason: "declared, detected on PATH", noneAvailable: false });
  const first = detected[0];
  if (first !== undefined)
    return ok({
      harness: first,
      reason: `detected on PATH (declared '${declared}' not installed)`,
      noneAvailable: false,
    });
  if (deps.env.vars["ANTHROPIC_API_KEY"] !== undefined)
    return ok({
      harness: "raw-api",
      reason: "no CLI detected; ANTHROPIC_API_KEY set",
      noneAvailable: false,
    });
  return ok({ harness: declared, reason: "declared (no harness detected)", noneAvailable: true });
}

function findEntry(
  index: Immutable<TemplateIndex>,
  name: string,
): Result<Immutable<TemplateEntry>, string> {
  const entry = index.templates.find((t) => t.name === name);
  return entry === undefined
    ? err(`unknown template '${name}' (run \`workflow list-templates\`)`)
    : ok(entry);
}

/** Resolve the conflict gate: returns true to proceed with writing, false to abort. */
async function confirmOverwrite(path: string, args: InitArgs, deps: AppDeps): Promise<boolean> {
  if (args.force || args.dryRun) return true;
  if (!deps.io.exists(path)) return true;
  if (!deps.env.isTTY) {
    deps.ui.print(`error: ${path} already exists (use --force to overwrite)\n`);
    return false;
  }
  const answer = (await deps.consent.io.question(`${path} exists — overwrite? [y/N]: `))
    .trim()
    .toLowerCase();
  if (answer === "y" || answer === "yes") return true;
  deps.ui.print("aborted\n");
  return false;
}

function nextSteps(entryDest: string, choice: HarnessChoice, deps: AppDeps): void {
  deps.ui.print(`\n✓ Created ${entryDest} (harness: ${choice.harness} — ${choice.reason})\n\n`);
  deps.ui.print(`  Try it free (no tokens):   workflow run ${entryDest} --mock\n`);
  deps.ui.print(`  Run for real:              workflow run ${entryDest} --yes\n`);
  deps.ui.print(`  Edit the prompt:           open ${entryDest}\n`);
  if (choice.noneAvailable)
    deps.ui.print(
      `\n  No harness detected on PATH. Install one (e.g. the Claude CLI) or set ANTHROPIC_API_KEY\n  to run for real; --mock works with nothing installed.\n`,
    );
}

/**
 * Scaffold a bundled template into the user's working directory — offline, deterministic, zero
 * tokens on the first run. Resolve → harness-adapt → conflict-check → write → (offer mock-run) →
 * print stack-aware next steps. With no template it shows the gallery (gallery-first discovery).
 */
export async function initCommand(args: InitArgs, deps: AppDeps): Promise<number> {
  if (args.template === undefined) return listTemplatesCommand({ json: false }, deps);

  const indexResult = loadTemplateIndex(deps);
  if (indexResult.isErr()) {
    deps.ui.print(`error: ${indexResult.error}\n`);
    return 1;
  }
  const entryResult = findEntry(indexResult.value, args.template);
  if (entryResult.isErr()) {
    deps.ui.print(`error: ${entryResult.error}\n`);
    return 1;
  }
  const entry = entryResult.value;

  const harnessResult = resolveHarness(entry.harness, args, deps);
  if (harnessResult.isErr()) {
    deps.ui.print(`error: ${harnessResult.error}\n`);
    return 1;
  }
  const choice = harnessResult.value;

  const baseDir = args.dir ?? deps.env.cwd;
  const srcDir = deps.env.templatesDir;

  // Plan the writes: [destPath, source] pairs. The entry file gets the harness rewrite; in a
  // multi-file template the sibling helpers are copied verbatim next to it.
  const writes: Array<{ path: string; data: string }> = [];
  let entryDest: string;

  if (entry.multiFile) {
    const dir = entry.dir ?? entry.name;
    const destDir = `${baseDir}/${entry.name}`;
    entryDest = `${destDir}/${entry.entry}`;
    for (const file of deps.io.readDir(`${srcDir}/${dir}`)) {
      const raw = deps.io.readText(`${srcDir}/${dir}/${file}`);
      if (raw === undefined) continue;
      const data = file === entry.entry ? rewriteHarness(raw, choice.harness) : raw;
      writes.push({ path: `${destDir}/${file}`, data });
    }
    if (writes.length === 0) {
      deps.ui.print(`error: template '${entry.name}' has no files in ${srcDir}/${dir}\n`);
      return 1;
    }
  } else {
    const raw = deps.io.readText(`${srcDir}/${entry.entry}`);
    if (raw === undefined) {
      deps.ui.print(`error: template file ${entry.entry} not found — reinstall defineworkflow\n`);
      return 1;
    }
    entryDest = `${baseDir}/${entry.name}.workflow.ts`;
    writes.push({ path: entryDest, data: rewriteHarness(raw, choice.harness) });
  }

  if (args.dryRun) {
    deps.ui.print("--dry-run: no files written\n");
    deps.ui.print(`  harness: ${choice.harness} (${choice.reason})\n`);
    for (const w of writes) deps.ui.print(`  would write: ${w.path}\n`);
    return 0;
  }

  // Conflict gate keys off the entry file (the multi-file helpers live beside it).
  if (!(await confirmOverwrite(entryDest, args, deps))) return 1;
  for (const w of writes) deps.io.writeText(w.path, w.data);

  nextSteps(entryDest, choice, deps);

  // The headline payoff: a working run in the real Ink UI, agent-free, token-free. Confirm only on
  // an interactive TTY; --run forces it; --yes / non-TTY never prompt (run only if --run).
  let shouldRun = args.run;
  if (!shouldRun && deps.env.isTTY && !args.noRun && !args.yes) {
    const answer = (
      await deps.consent.io.question("\nRun it now with mocked agents (no tokens)? [Y/n]: ")
    )
      .trim()
      .toLowerCase();
    shouldRun = answer !== "n" && answer !== "no";
  }
  if (shouldRun)
    return runCommand(
      { script: entryDest, detach: false, yes: true, mock: args.mode === "mock" },
      deps,
    );
  return 0;
}
