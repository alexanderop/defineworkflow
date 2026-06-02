import type { WorkflowGraph, WorkflowGraphEdge, WorkflowGraphNode } from "./workflow-graph.js";

const INDENT = "    ";
const BRANCH = "├── ";
const LAST = "└── ";
const CONTINUE = "│   ";

interface RenderArgs {
  readonly id: string;
  readonly prefix: string;
  readonly childrenById: ReadonlyMap<string, readonly WorkflowGraphEdge[]>;
  readonly nodesById: ReadonlyMap<string, WorkflowGraphNode>;
  readonly expanded: Set<string>;
  readonly lines: string[];
  /** Omit this node from the current subtree; used to show a parallel join only once. */
  readonly stopBeforeId?: string;
}

export function renderWorkflowGraphAscii(graph: WorkflowGraph): string {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const childrenById = adjacency(graph.edges);
  const root = nodesById.get("root") ?? graph.nodes[0];
  const lines = [`Workflow: ${graph.workflow.name} (${graph.workflow.harness})`, ""];

  if (root === undefined) {
    lines.push("(no graph nodes)");
  } else {
    const expanded = new Set<string>();
    lines.push(nodeLabel(root));
    expanded.add(root.id);
    renderChildren({ id: root.id, prefix: "", childrenById, nodesById, expanded, lines });
  }

  if (graph.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of graph.warnings) {
      const location = warning.location
        ? ` (${warning.location.file}:${warning.location.line}:${warning.location.column})`
        : "";
      lines.push(`- ${warning.code}: ${warning.message}${location}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderChildren(args: RenderArgs): void {
  const children = withoutStop(args.childrenById.get(args.id) ?? [], args.stopBeforeId);
  const node = args.nodesById.get(args.id);
  const branchEdges = children.filter((edge) => edge.kind === "parallel-branch");
  const commonJoinId =
    branchEdges.length > 1
      ? findCommonJoin(
          branchEdges.map((edge) => edge.to),
          args,
        )
      : undefined;

  if (node?.type === "parallel" && commonJoinId !== undefined) {
    renderParallelChildren(args, branchEdges, commonJoinId);
    return;
  }

  renderEdges(args, children);
}

function renderParallelChildren(
  args: RenderArgs,
  branchEdges: readonly WorkflowGraphEdge[],
  joinId: string,
): void {
  branchEdges.forEach((edge, index) => {
    const child = args.nodesById.get(edge.to);
    const connector = BRANCH;
    const nextPrefix = `${args.prefix}${CONTINUE}`;

    if (child === undefined) {
      args.lines.push(`${args.prefix}${connector}branch ${index + 1} ▶ ? ${edge.to}`);
      return;
    }

    if (args.expanded.has(child.id)) {
      args.lines.push(`${args.prefix}${connector}branch ${index + 1} ▶ ↩ ${nodeLabel(child)}`);
      return;
    }

    args.lines.push(`${args.prefix}${connector}branch ${index + 1} ▶ ${nodeLabel(child)}`);
    args.expanded.add(child.id);
    renderChildren({ ...args, id: child.id, prefix: nextPrefix, stopBeforeId: joinId });
  });

  const join = args.nodesById.get(joinId);
  if (join === undefined) {
    args.lines.push(`${args.prefix}${LAST}? ${joinId}`);
    return;
  }

  if (args.expanded.has(join.id)) {
    args.lines.push(`${args.prefix}${LAST}↩ ${nodeLabel(join)}`);
    return;
  }

  args.lines.push(`${args.prefix}${LAST}${nodeLabel(join)}`);
  args.expanded.add(join.id);
  renderChildren({ ...args, id: join.id, prefix: `${args.prefix}${INDENT}` });
}

function renderEdges(args: RenderArgs, children: readonly WorkflowGraphEdge[]): void {
  children.forEach((edge, index) => {
    const child = args.nodesById.get(edge.to);
    const isLast = index === children.length - 1;
    const connector = isLast ? LAST : BRANCH;
    const nextPrefix = `${args.prefix}${isLast ? INDENT : CONTINUE}`;
    const edgeText = edgeLabel(edge);

    if (child === undefined) {
      args.lines.push(`${args.prefix}${connector}${edgeText}? ${edge.to}`);
      return;
    }

    if (args.expanded.has(child.id)) {
      args.lines.push(`${args.prefix}${connector}${edgeText}↩ ${nodeLabel(child)}`);
      return;
    }

    args.lines.push(`${args.prefix}${connector}${edgeText}${nodeLabel(child)}`);
    args.expanded.add(child.id);
    renderChildren({ ...args, id: child.id, prefix: nextPrefix });
  });
}

function findCommonJoin(starts: readonly string[], args: RenderArgs): string | undefined {
  const reachable = starts.map((start) => reachableJoins(start, args));
  const first = reachable[0];
  if (first === undefined) return undefined;

  let best: { readonly id: string; readonly score: number } | undefined;
  for (const [id, distance] of first) {
    let score = distance;
    let common = true;
    for (const joins of reachable.slice(1)) {
      const otherDistance = joins.get(id);
      if (otherDistance === undefined) {
        common = false;
        break;
      }
      score = Math.max(score, otherDistance);
    }
    if (common && (best === undefined || score < best.score)) best = { id, score };
  }
  return best?.id;
}

function reachableJoins(start: string, args: RenderArgs): ReadonlyMap<string, number> {
  const joins = new Map<string, number>();
  const visited = new Set<string>();
  const queue: Array<{ readonly id: string; readonly distance: number }> = [
    { id: start, distance: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || visited.has(current.id)) continue;
    visited.add(current.id);

    const node = args.nodesById.get(current.id);
    if (node?.type === "join") joins.set(current.id, current.distance);

    for (const edge of args.childrenById.get(current.id) ?? []) {
      queue.push({ id: edge.to, distance: current.distance + 1 });
    }
  }

  return joins;
}

function withoutStop(
  edges: readonly WorkflowGraphEdge[],
  stopBeforeId: string | undefined,
): readonly WorkflowGraphEdge[] {
  return stopBeforeId === undefined ? edges : edges.filter((edge) => edge.to !== stopBeforeId);
}

function adjacency(
  edges: readonly WorkflowGraphEdge[],
): ReadonlyMap<string, readonly WorkflowGraphEdge[]> {
  const byId = new Map<string, WorkflowGraphEdge[]>();
  for (const edge of edges) {
    const existing = byId.get(edge.from);
    if (existing) existing.push(edge);
    else byId.set(edge.from, [edge]);
  }
  return byId;
}

function edgeLabel(edge: WorkflowGraphEdge): string {
  const label = edge.label ?? (edge.kind === "sequence" ? undefined : edge.kind);
  return label ? `${label} ▶ ` : "";
}

function nodeLabel(node: WorkflowGraphNode): string {
  switch (node.type) {
    case "workflow":
      return `◎ ${node.label}`;
    case "phase":
      return `[phase] ${node.label}`;
    case "agent":
      return `🤖 ${node.label}${node.hasSchema ? " {schema}" : ""}`;
    case "parallel":
      return `◇ ${node.label}`;
    case "join":
      return `○ ${node.label}`;
    case "pipeline":
      return `⬡ ${node.label}`;
    case "stage":
      return `[stage] ${node.label}`;
    case "question":
      return `? ${node.label}`;
    case "nested-workflow":
      return `▣ ${node.label}`;
    case "output":
      return `⇥ ${node.label}`;
    case "dynamic":
      return `⋯ ${node.label}`;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}
