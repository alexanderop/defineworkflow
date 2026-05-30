<script setup lang="ts">
import {
  accentColor,
  arrowheadPath,
  measureText,
  polylinePath,
  seedFrom,
  svgText,
  type AccentName,
  type Point,
  type RoughDrawCtx,
} from "./useRough";
import { usePrimitive } from "./usePrimitive";

const props = withDefaults(
  defineProps<{
    /** [x, y] start */
    from: [number, number];
    /** [x, y] end (arrowhead here) */
    to: [number, number];
    /** optional intermediate bend points */
    via?: [number, number][];
    accent?: AccentName | boolean;
    dashed?: boolean;
    label?: string;
    head?: boolean;
  }>(),
  { via: () => [], dashed: false, label: "", head: true },
);

usePrimitive(({ rc, palette, append }: RoughDrawCtx) => {
  const color = accentColor(palette, props.accent) ?? palette.line;
  const seed = seedFrom(`arr:${props.from.join()}->${props.to.join()}`);
  const points: Point[] = [
    { x: props.from[0], y: props.from[1] },
    ...props.via.map(([x, y]) => ({ x, y })),
    { x: props.to[0], y: props.to[1] },
  ];

  append(
    rc.path(polylinePath(points), {
      stroke: color,
      strokeWidth: 1.4,
      roughness: 1.1,
      bowing: 1,
      seed,
      ...(props.dashed ? { strokeLineDash: [6, 5] } : {}),
    }),
  );

  if (props.head) {
    const tip = points[points.length - 1]!;
    const prev = points[points.length - 2]!;
    append(
      rc.path(arrowheadPath(prev, tip), {
        stroke: color,
        strokeWidth: 1.4,
        roughness: 0.8,
        seed,
      }),
    );
  }

  if (props.label) {
    const fam =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--vp-font-family-mono")
        .trim() || "monospace";
    const mid = points[Math.floor(points.length / 2)]!;
    const tw = measureText(props.label, `13px ${fam}`);
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", String(mid.x - tw / 2 - 4));
    bg.setAttribute("y", String(mid.y - 9));
    bg.setAttribute("width", String(tw + 8));
    bg.setAttribute("height", "18");
    bg.setAttribute("rx", "3");
    bg.setAttribute("fill", palette.bg);
    append(bg);
    append(
      svgText(mid.x, mid.y, props.label, {
        fill: palette.muted,
        size: 13,
        family: fam,
      }),
    );
  }
});
</script>

<template><span style="display: none" /></template>
