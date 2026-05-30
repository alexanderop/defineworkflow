<script setup lang="ts">
import { accentColor, svgText, type AccentName, type RoughDrawCtx } from "./useRough";
import { usePrimitive } from "./usePrimitive";

const props = withDefaults(
  defineProps<{
    x: number;
    y: number;
    text: string;
    anchor?: "start" | "middle" | "end";
    accent?: AccentName | boolean;
    muted?: boolean;
    size?: number;
    weight?: number;
    italic?: boolean;
  }>(),
  { anchor: "middle", muted: false, size: 14, weight: 400, italic: false },
);

usePrimitive(({ palette, append }: RoughDrawCtx) => {
  const fam =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--vp-font-family-mono")
      .trim() || "monospace";
  const fill = accentColor(palette, props.accent) ?? (props.muted ? palette.muted : palette.text);
  append(
    svgText(props.x, props.y, props.text, {
      fill,
      size: props.size,
      family: fam,
      anchor: props.anchor,
      weight: props.weight,
      italic: props.italic,
    }),
  );
});
</script>

<template><span style="display: none" /></template>
