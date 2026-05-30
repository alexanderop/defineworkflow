<script setup lang="ts">
import { accentColor, seedFrom, svgText, type AccentName, type RoughDrawCtx } from "./useRough";
import { usePrimitive } from "./usePrimitive";

const props = withDefaults(
  defineProps<{
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
    sub?: string;
    accent?: AccentName | boolean;
    shape?: "box" | "ellipse";
    fontSize?: number;
  }>(),
  { label: "", sub: "", shape: "box", fontSize: 14 },
);

function family(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--vp-font-family-mono")
      .trim() || "monospace"
  );
}

usePrimitive(({ rc, palette, append }: RoughDrawCtx) => {
  const accent = accentColor(palette, props.accent);
  const stroke = accent ?? palette.stroke;
  const seed = seedFrom(`box:${props.x},${props.y},${props.label}`);
  const cx = props.x + props.width / 2;
  const cy = props.y + props.height / 2;

  if (props.shape === "ellipse") {
    append(
      rc.ellipse(cx, cy, props.width, props.height, {
        fill: palette.panel,
        fillStyle: "solid",
        stroke,
        strokeWidth: 1.6,
        roughness: 1.2,
        seed,
      }),
    );
  } else {
    append(
      rc.rectangle(props.x, props.y, props.width, props.height, {
        fill: palette.panel,
        fillStyle: "solid",
        stroke,
        strokeWidth: 1.6,
        roughness: 1.1,
        bowing: 1.4,
        seed,
      }),
    );
  }

  const fam = family();
  if (props.sub) {
    append(
      svgText(cx, cy - props.fontSize / 2, props.label, {
        fill: accent ?? palette.text,
        size: props.fontSize,
        family: fam,
        weight: 600,
      }),
    );
    append(
      svgText(cx, cy + props.fontSize / 2 + 1, props.sub, {
        fill: palette.muted,
        size: props.fontSize - 2,
        family: fam,
      }),
    );
  } else if (props.label) {
    append(
      svgText(cx, cy, props.label, {
        fill: accent ?? palette.text,
        size: props.fontSize,
        family: fam,
        weight: 600,
      }),
    );
  }
});
</script>

<template><span style="display: none" /></template>
