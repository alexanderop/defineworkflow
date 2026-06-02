import type { WorkflowGraph, WorkflowGraphEdge, WorkflowGraphNode } from "./workflow-graph.js";

interface DotAttrs {
  readonly label: string;
  readonly shape?: string;
  readonly style?: string;
  readonly fillcolor?: string;
  readonly color?: string;
  readonly fontcolor?: string;
}

export function renderWorkflowGraphDot(graph: WorkflowGraph): string {
  const lines = [
    "digraph workflow {",
    "  rankdir=LR;",
    '  node [fontname="Helvetica"];',
    '  edge [fontname="Helvetica"];',
    "",
  ];
  if (graph.warnings.length > 0) {
    lines.push(`  graph [labelloc="b", label="${escapeDot(warningsLabel(graph))}"];`, "");
  }
  for (const node of graph.nodes) {
    lines.push(`  ${dotId(node.id)} [${attrs(nodeAttrs(node))}];`);
  }
  if (graph.nodes.length > 0) lines.push("");
  for (const edge of graph.edges) {
    const renderedAttrs = attrs(edgeAttrs(edge));
    lines.push(
      renderedAttrs
        ? `  ${dotId(edge.from)} -> ${dotId(edge.to)} [${renderedAttrs}];`
        : `  ${dotId(edge.from)} -> ${dotId(edge.to)};`,
    );
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function nodeAttrs(node: WorkflowGraphNode): DotAttrs {
  switch (node.type) {
    case "workflow":
      return { label: node.label, shape: "doublecircle", style: "filled", fillcolor: "#f8fafc" };
    case "phase":
      return {
        label: node.label,
        shape: "box",
        style: "rounded,filled",
        fillcolor: "#dbeafe",
        color: "#2563eb",
      };
    case "agent":
      return {
        label: `agent: ${node.label}`,
        shape: "box",
        style: "filled",
        fillcolor: "#f3e8ff",
        color: "#9333ea",
      };
    case "parallel":
      return {
        label: node.label,
        shape: "diamond",
        style: "filled",
        fillcolor: "#cffafe",
        color: "#0891b2",
      };
    case "join":
      return {
        label: node.label,
        shape: "circle",
        style: "filled",
        fillcolor: "#ecfeff",
        color: "#0891b2",
      };
    case "pipeline":
      return {
        label: node.label,
        shape: "hexagon",
        style: "filled",
        fillcolor: "#dcfce7",
        color: "#16a34a",
      };
    case "stage":
      return {
        label: node.label,
        shape: "box",
        style: "rounded,filled",
        fillcolor: "#f0fdf4",
        color: "#16a34a",
      };
    case "question":
      return {
        label: `question: ${node.label}`,
        shape: "note",
        style: "filled",
        fillcolor: "#fef3c7",
        color: "#d97706",
      };
    case "nested-workflow":
      return {
        label: node.label,
        shape: "box3d",
        style: "filled",
        fillcolor: "#fce7f3",
        color: "#db2777",
      };
    case "output":
      return {
        label: `output: ${node.label}`,
        shape: "tab",
        style: "filled",
        fillcolor: "#ffffff",
        color: "#64748b",
      };
    case "dynamic":
      return {
        label: node.label,
        shape: "box",
        style: "dashed,filled",
        fillcolor: "#f1f5f9",
        color: "#64748b",
        fontcolor: "#475569",
      };
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

function edgeAttrs(edge: WorkflowGraphEdge): DotAttrs {
  const label = edge.label ?? (edge.kind === "sequence" ? "" : edge.kind);
  const base = label ? { label } : { label: "" };
  switch (edge.kind) {
    case "parallel-branch":
      return { ...base, color: "#0891b2" };
    case "pipeline-stage":
      return { ...base, color: "#16a34a" };
    case "returns":
      return { ...base, color: "#64748b" };
    case "dynamic":
      return { ...base, style: "dashed", color: "#64748b" };
    case "contains":
      return { ...base, style: "dotted", color: "#64748b" };
    case "sequence":
      return base;
    default: {
      const unreachable: never = edge.kind;
      return unreachable;
    }
  }
}

function attrs(values: DotAttrs): string {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}="${escapeDot(String(value))}"`)
    .join(", ");
}

function dotId(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : `"${escapeDot(value)}"`;
}

function warningsLabel(graph: WorkflowGraph): string {
  const details = graph.warnings
    .slice(0, 3)
    .map((warning) => `• ${warning.code}: ${warning.message}`);
  const suffix =
    graph.warnings.length > details.length
      ? `\n• +${graph.warnings.length - details.length} more warning(s)`
      : "";
  return `⚠ graph is approximate\n${details.join("\n")}${suffix}`;
}

function escapeDot(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
