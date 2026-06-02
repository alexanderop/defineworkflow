import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import type { ProcessRunner } from "@workflow/adapters";

export async function renderDotSvg(args: {
  readonly dot: string;
  readonly cwd: string;
  readonly processRunner: ProcessRunner;
}): Promise<Result<string, string>> {
  const controller = new AbortController();
  try {
    const out = await args.processRunner.run({
      command: "dot",
      args: ["-Tsvg"],
      cwd: args.cwd,
      signal: controller.signal,
      stdin: args.dot,
    });
    if (out.code !== 0) {
      return err(
        `Graphviz dot failed${out.stderr.trim() ? `: ${out.stderr.trim()}` : ""}. Install Graphviz or use --format dot.`,
      );
    }
    if (!out.stdout.trim()) return err("Graphviz dot produced no SVG output");
    return ok(out.stdout);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to render SVG with Graphviz dot: ${message}`);
  }
}
