<script setup lang="ts">
import { accentColor, seedFrom, type AccentName, type RoughDrawCtx } from "./useRough";
import { usePrimitive } from "./usePrimitive";

/**
 * A square grouping bracket (like `┐ ├ ┘`) — a vertical bar spanning `y..y+height`
 * with short arms at the ends and a longer connector arm at the middle pointing
 * toward whatever the group feeds into. `side: "left"` points its arms right
 * (groups items on the right); `side: "right"` mirrors it.
 */
const props = withDefaults(
  defineProps<{
    x: number;
    y: number;
    height: number;
    side?: "left" | "right";
    arm?: number;
    connector?: number;
    accent?: AccentName | boolean;
  }>(),
  { side: "left", arm: 10, connector: 22 },
);

usePrimitive(({ rc, palette, append }: RoughDrawCtx) => {
  const color = accentColor(palette, props.accent) ?? palette.line;
  const dir = props.side === "left" ? 1 : -1;
  const seed = seedFrom(`brk:${props.x},${props.y},${props.height}`);
  const opts = { stroke: color, strokeWidth: 1.4, roughness: 1, seed };
  const top = props.y;
  const bot = props.y + props.height;
  const mid = props.y + props.height / 2;

  // spine
  append(rc.line(props.x, top, props.x, bot, opts));
  // end arms
  append(rc.line(props.x, top, props.x + dir * props.arm, top, opts));
  append(rc.line(props.x, bot, props.x + dir * props.arm, bot, opts));
  // connector arm
  append(rc.line(props.x, mid, props.x + dir * props.connector, mid, opts));
});
</script>

<template><span style="display: none" /></template>
