import { onMounted, onUnmounted, ref, type InjectionKey, type Ref } from "vue";

/**
 * Theme-reactive helpers for the rough.js diagram components.
 *
 * Colors are read from the live CSS variables on <html> so diagrams track the
 * VitePress light/dark toggle. rough.js + dagre are loaded lazily inside the
 * components (never at SSR time), so this module stays DOM-free on import.
 */

export type AccentName = "amber" | "cyan" | "green" | "red" | "violet";

export interface RoughPalette {
  /** default stroke for lines / arrows */
  line: string;
  /** node border + arrowheads */
  stroke: string;
  /** primary label text */
  text: string;
  /** captions, edge labels, secondary text */
  muted: string;
  /** node fill */
  panel: string;
  /** page background (used to mask edge-label backdrops) */
  bg: string;
  accents: Record<AccentName, string>;
}

const FALLBACK: RoughPalette = {
  line: "#9aa0a8",
  stroke: "#5b6168",
  text: "#e7e3d8",
  muted: "#5b6168",
  panel: "#171b21",
  bg: "#0a0b0d",
  accents: {
    amber: "#ffb000",
    cyan: "#5ad1e0",
    green: "#67e08a",
    red: "#ff5d54",
    violet: "#b69cff",
  },
};

function cssVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = style.getPropertyValue(name).trim();
  return v || fallback;
}

export function readPalette(): RoughPalette {
  if (typeof document === "undefined") return FALLBACK;
  const s = getComputedStyle(document.documentElement);
  return {
    line: cssVar(s, "--vp-c-text-2", FALLBACK.line),
    stroke: cssVar(s, "--vp-c-text-3", FALLBACK.stroke),
    text: cssVar(s, "--vp-c-text-1", FALLBACK.text),
    muted: cssVar(s, "--vp-c-text-3", FALLBACK.muted),
    panel: cssVar(s, "--wf-panel-2", FALLBACK.panel),
    bg: cssVar(s, "--vp-c-bg", FALLBACK.bg),
    accents: {
      amber: cssVar(s, "--wf-amber", FALLBACK.accents.amber),
      cyan: cssVar(s, "--wf-cyan", FALLBACK.accents.cyan),
      green: cssVar(s, "--wf-green", FALLBACK.accents.green),
      red: cssVar(s, "--wf-red", FALLBACK.accents.red),
      violet: cssVar(s, "--wf-violet", FALLBACK.accents.violet),
    },
  };
}

/**
 * Reactive palette that refreshes whenever VitePress toggles the `.dark` class
 * on <html>. Returns a ref components can watch to trigger a redraw.
 */
export function useRoughPalette(): Ref<RoughPalette> {
  const palette = ref<RoughPalette>(FALLBACK);
  let observer: MutationObserver | null = null;

  onMounted(() => {
    palette.value = readPalette();
    observer = new MutationObserver(() => {
      palette.value = readPalette();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  });

  onUnmounted(() => observer?.disconnect());

  return palette;
}

/** Resolve an accent name (or `true` → amber) to a concrete color. */
export function accentColor(
  palette: RoughPalette,
  accent: AccentName | boolean | undefined,
): string | null {
  if (!accent) return null;
  if (accent === true) return palette.accents.amber;
  return palette.accents[accent];
}

/** Deterministic 32-bit seed from a string so a sketch is stable across redraws. */
export function seedFrom(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Measure rendered text width using a shared offscreen canvas. */
export function measureText(text: string, font: string): number {
  if (typeof document === "undefined") return text.length * 8;
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return text.length * 8;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export interface TextOptions {
  fill: string;
  size: number;
  family: string;
  anchor?: "start" | "middle" | "end";
  weight?: number | string;
  italic?: boolean;
}

/** Create a crisp SVG <text> element (labels stay legible — only shapes are sketchy). */
export function svgText(x: number, y: number, content: string, o: TextOptions): SVGTextElement {
  const el = document.createElementNS(SVG_NS, "text");
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("fill", o.fill);
  el.setAttribute("font-size", String(o.size));
  el.setAttribute("font-family", o.family);
  el.setAttribute("text-anchor", o.anchor ?? "middle");
  el.setAttribute("dominant-baseline", "central");
  if (o.weight !== undefined) el.setAttribute("font-weight", String(o.weight));
  if (o.italic) el.setAttribute("font-style", "italic");
  el.textContent = content;
  return el;
}

export interface Point {
  x: number;
  y: number;
}

type RoughOptions = Record<string, unknown>;

/** Minimal surface of `rough.svg()` we use — avoids depending on internal type paths. */
export interface RoughSvg {
  rectangle(x: number, y: number, w: number, h: number, o?: RoughOptions): SVGGElement;
  ellipse(cx: number, cy: number, w: number, h: number, o?: RoughOptions): SVGGElement;
  line(x1: number, y1: number, x2: number, y2: number, o?: RoughOptions): SVGGElement;
  path(d: string, o?: RoughOptions): SVGGElement;
}

/** Context handed to each primitive's draw callback by <RoughCanvas>. */
export interface RoughDrawCtx {
  rc: RoughSvg;
  palette: RoughPalette;
  svg: SVGSVGElement;
  append: (el: SVGElement) => void;
}

export type RoughDrawFn = (ctx: RoughDrawCtx) => void;

export interface RoughCanvasApi {
  register: (fn: RoughDrawFn) => void;
  unregister: (fn: RoughDrawFn) => void;
}

export const roughCanvasKey: InjectionKey<RoughCanvasApi> = Symbol("roughCanvas");

/** Build an SVG path `d` string from a polyline of points. */
export function polylinePath(points: Point[]): string {
  if (points.length === 0) return "";
  const [head, ...rest] = points;
  return `M ${head.x} ${head.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(" ");
}

/**
 * Two short strokes forming an arrowhead at `tip`, pointing along the direction
 * from `from` → `tip`. Returned as a path `d` string for rc.path().
 */
export function arrowheadPath(from: Point, tip: Point, size = 9): string {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const spread = Math.PI / 7;
  const a = {
    x: tip.x - size * Math.cos(angle - spread),
    y: tip.y - size * Math.sin(angle - spread),
  };
  const b = {
    x: tip.x - size * Math.cos(angle + spread),
    y: tip.y - size * Math.sin(angle + spread),
  };
  return `M ${a.x} ${a.y} L ${tip.x} ${tip.y} L ${b.x} ${b.y}`;
}
