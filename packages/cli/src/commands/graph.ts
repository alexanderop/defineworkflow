import type { AppDeps } from "../app.js";
import { bundleWorkflow } from "../bundle.js";
import { loadMeta } from "../loader.js";
import { resolveSavedWorkflow } from "../resolve.js";
import { buildWorkflowGraph } from "../workflow-graph.js";
import { renderWorkflowGraphAscii } from "../workflow-graph-ascii.js";
import { renderWorkflowGraphDot } from "../workflow-graph-dot.js";
import { renderDotSvg } from "../workflow-graph-svg.js";

export type GraphFormat = "ascii" | "dot" | "json" | "svg";

export interface GraphArgs {
  readonly target: string;
  readonly format?: string | undefined;
  readonly output?: string | undefined;
}

export async function graphCommand(args: GraphArgs, deps: AppDeps): Promise<number> {
  const format = parseFormat(args.format);
  if (format === undefined) {
    deps.ui.print("error: --format must be one of ascii, dot, json, svg\n");
    return 1;
  }

  const resolved = resolveGraphTarget(args.target, deps);
  if (!resolved) {
    deps.ui.print(`error: cannot read workflow ${args.target}\n`);
    return 1;
  }

  const bundled = await bundleWorkflow({ path: resolved.path, source: resolved.source });
  if (bundled.isErr()) {
    deps.ui.print(`error: ${bundled.error}\n`);
    return 1;
  }

  let meta;
  try {
    meta = loadMeta(bundled.value);
  } catch (e) {
    deps.ui.print(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  const graph = buildWorkflowGraph({
    file: resolved.path,
    source: bundled.value,
    meta,
    includeLocations: bundled.value === resolved.source,
  });
  const rendered = await render(format, graph, deps);
  if (rendered.kind === "error") {
    deps.ui.print(`error: ${rendered.message}\n`);
    return 1;
  }

  if (args.output !== undefined) {
    deps.io.writeText(args.output, rendered.text);
  } else {
    deps.ui.print(rendered.text);
  }
  return 0;
}

function parseFormat(format: string | undefined): GraphFormat | undefined {
  if (format === undefined) return "dot";
  if (format === "ascii" || format === "dot" || format === "json" || format === "svg")
    return format;
  return undefined;
}

function resolveGraphTarget(
  target: string,
  deps: AppDeps,
): { readonly path: string; readonly source: string } | undefined {
  const direct = deps.io.readText(target);
  if (direct !== undefined) return { path: target, source: direct };
  return resolveSavedWorkflow(target, {
    homeDir: deps.env.homeDir,
    cwd: deps.env.cwd,
    bundledDir: deps.env.bundledDir,
    readFile: deps.io.readText,
  });
}

async function render(
  format: GraphFormat,
  graph: ReturnType<typeof buildWorkflowGraph>,
  deps: AppDeps,
): Promise<
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "error"; readonly message: string }
> {
  if (format === "json") return { kind: "ok", text: `${JSON.stringify(graph, null, 2)}\n` };
  if (format === "ascii") return { kind: "ok", text: renderWorkflowGraphAscii(graph) };
  const dot = renderWorkflowGraphDot(graph);
  if (format === "dot") return { kind: "ok", text: dot };
  const svg = await renderDotSvg({
    dot,
    cwd: deps.env.cwd,
    processRunner: deps.adapters.processRunner,
  });
  if (svg.isErr()) return { kind: "error", message: svg.error };
  return { kind: "ok", text: svg.value };
}
