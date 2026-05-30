<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import {
  accentColor,
  arrowheadPath,
  measureText,
  polylinePath,
  seedFrom,
  svgText,
  useRoughPalette,
  type AccentName,
  type Point,
} from "./useRough";

interface DiagramNode {
  id: string;
  label: string;
  /** optional second line, dimmer (e.g. "seq → result") */
  sub?: string;
  accent?: AccentName | boolean;
  shape?: "box" | "pill" | "ellipse";
}

type EdgeTuple = [string, string];
interface EdgeObject {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}
type EdgeInput = EdgeTuple | EdgeObject;

interface DagreNode {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface DagreGraph {
  setGraph(o: object): void;
  setDefaultEdgeLabel(fn: () => object): void;
  setNode(id: string, o: { width: number; height: number }): void;
  setEdge(from: string, to: string): void;
  graph(): { width?: number; height?: number };
  nodes(): string[];
  node(id: string): DagreNode | undefined;
  edge(from: string, to: string): { points?: Point[] } | undefined;
}

const props = withDefaults(
  defineProps<{
    nodes: DiagramNode[];
    edges?: EdgeInput[];
    direction?: "LR" | "TB";
    nodesep?: number;
    ranksep?: number;
    caption?: string;
    fontSize?: number;
  }>(),
  {
    edges: () => [],
    direction: "LR",
    nodesep: 26,
    ranksep: 58,
    caption: "",
    fontSize: 14,
  },
);

const svgRef = ref<SVGSVGElement | null>(null);
const palette = useRoughPalette();
const SVG_NS = "http://www.w3.org/2000/svg";
const PAD_X = 16;
const PAD_Y = 12;
const LINE_GAP = 5;

function normalizeEdges(): EdgeObject[] {
  return props.edges.map((e) =>
    Array.isArray(e) ? { from: e[0], to: e[1] } : e,
  );
}

function fontFor(weight = 400): string {
  const family = getComputedStyle(document.documentElement)
    .getPropertyValue("--vp-font-family-mono")
    .trim() || "monospace";
  return `${weight} ${props.fontSize}px ${family}`;
}

async function redraw(): Promise<void> {
  const svg = svgRef.value;
  if (!svg) return;

  const [{ default: rough }, dagreMod] = await Promise.all([
    import("roughjs"),
    import("@dagrejs/dagre"),
  ]);
  // @dagrejs/dagre is CJS; its ESM interop exposes the API under `default`
  // (with `graphlib.Graph` + `layout`), not as flat named exports.
  const dagre = (dagreMod as { default?: unknown }).default ?? dagreMod;
  const { Graph } = (dagre as { graphlib: { Graph: new (o?: object) => DagreGraph } }).graphlib;
  const layout = (dagre as { layout: (g: DagreGraph) => void }).layout;

  const pal = palette.value;
  const labelFont = fontFor(500);
  const subFont = fontFor(400);
  const family = getComputedStyle(document.documentElement)
    .getPropertyValue("--vp-font-family-mono")
    .trim() || "monospace";

  // --- measure + lay out ----------------------------------------------------
  const g = new Graph({ multigraph: false, compound: false });
  g.setGraph({
    rankdir: props.direction,
    nodesep: props.nodesep,
    ranksep: props.ranksep,
    marginx: 10,
    marginy: 10,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of props.nodes) {
    const labelW = measureText(n.label, labelFont);
    const subW = n.sub ? measureText(n.sub, subFont) : 0;
    const width = Math.max(64, Math.ceil(Math.max(labelW, subW)) + PAD_X * 2);
    const lines = n.sub ? 2 : 1;
    const height = props.fontSize * lines + (lines - 1) * LINE_GAP + PAD_Y * 2;
    g.setNode(n.id, { width, height });
  }
  const edges = normalizeEdges();
  for (const e of edges) g.setEdge(e.from, e.to);

  layout(g);

  const graphW = g.graph().width ?? 0;
  const graphH = g.graph().height ?? 0;
  const captionH = props.caption ? props.fontSize + 18 : 0;
  const totalH = graphH + captionH;

  // --- reset svg ------------------------------------------------------------
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute("viewBox", `0 0 ${graphW} ${totalH}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("role", "img");
  svg.style.maxWidth = `${Math.ceil(graphW)}px`;

  const rc = rough.svg(svg);
  const nodeById = new Map(props.nodes.map((n) => [n.id, n]));

  // --- edges (drawn under nodes) -------------------------------------------
  for (const e of edges) {
    const ge = g.edge(e.from, e.to);
    const points = (ge?.points ?? []) as Point[];
    if (points.length < 2) continue;
    const seed = seedFrom(`${e.from}->${e.to}`);
    const line = rc.path(polylinePath(points), {
      stroke: pal.line,
      strokeWidth: 1.4,
      roughness: 1.1,
      bowing: 1,
      seed,
    });
    svg.appendChild(line);

    const tip = points[points.length - 1]!;
    const prev = points[points.length - 2]!;
    const head = rc.path(arrowheadPath(prev, tip), {
      stroke: pal.line,
      strokeWidth: 1.4,
      roughness: 0.8,
      seed,
    });
    svg.appendChild(head);

    if (e.label) {
      const mid = points[Math.floor(points.length / 2)]!;
      const tw = measureText(e.label, subFont);
      const bg = document.createElementNS(SVG_NS, "rect");
      bg.setAttribute("x", String(mid.x - tw / 2 - 4));
      bg.setAttribute("y", String(mid.y - props.fontSize / 2 - 2));
      bg.setAttribute("width", String(tw + 8));
      bg.setAttribute("height", String(props.fontSize + 4));
      bg.setAttribute("fill", pal.bg);
      bg.setAttribute("rx", "3");
      svg.appendChild(bg);
      svg.appendChild(
        svgText(mid.x, mid.y, e.label, {
          fill: pal.muted,
          size: props.fontSize - 1,
          family,
        }),
      );
    }
  }

  // --- nodes ---------------------------------------------------------------
  for (const id of g.nodes()) {
    const meta = g.node(id);
    const node = nodeById.get(id);
    if (!meta || !node) continue;
    const x = meta.x - meta.width / 2;
    const y = meta.y - meta.height / 2;
    const accent = accentColor(pal, node.accent);
    const stroke = accent ?? pal.stroke;
    const seed = seedFrom(id);

    let shapeNode: SVGGElement;
    if (node.shape === "ellipse") {
      shapeNode = rc.ellipse(meta.x, meta.y, meta.width, meta.height, {
        fill: pal.panel,
        fillStyle: "solid",
        stroke,
        strokeWidth: 1.6,
        roughness: 1.2,
        seed,
      });
    } else {
      shapeNode = rc.rectangle(x, y, meta.width, meta.height, {
        fill: pal.panel,
        fillStyle: "solid",
        stroke,
        strokeWidth: 1.6,
        roughness: 1.1,
        bowing: 1.4,
        seed,
      });
    }
    svg.appendChild(shapeNode);

    if (node.sub) {
      const topY = meta.y - (props.fontSize + LINE_GAP) / 2;
      const botY = meta.y + (props.fontSize + LINE_GAP) / 2;
      svg.appendChild(
        svgText(meta.x, topY, node.label, {
          fill: accent ?? pal.text,
          size: props.fontSize,
          family,
          weight: 600,
        }),
      );
      svg.appendChild(
        svgText(meta.x, botY, node.sub, {
          fill: pal.muted,
          size: props.fontSize - 2,
          family,
        }),
      );
    } else {
      svg.appendChild(
        svgText(meta.x, meta.y, node.label, {
          fill: accent ?? pal.text,
          size: props.fontSize,
          family,
          weight: 600,
        }),
      );
    }
  }

  // --- caption -------------------------------------------------------------
  if (props.caption) {
    svg.appendChild(
      svgText(graphW / 2, graphH + captionH / 2, props.caption, {
        fill: pal.muted,
        size: props.fontSize - 2,
        family,
        italic: true,
      }),
    );
  }
}

onMounted(redraw);
watch(palette, redraw, { deep: true });
</script>

<template>
  <figure class="rough-diagram">
    <svg ref="svgRef" :aria-label="caption || 'diagram'" />
  </figure>
</template>

<style scoped>
.rough-diagram {
  margin: 1.5rem auto;
  text-align: center;
}
.rough-diagram svg {
  height: auto;
  display: block;
  margin: 0 auto;
}
</style>
