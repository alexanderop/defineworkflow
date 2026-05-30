<script setup lang="ts">
import { nextTick, onMounted, provide, ref, watch } from "vue";
import {
  roughCanvasKey,
  useRoughPalette,
  type RoughCanvasApi,
  type RoughDrawFn,
  type RoughSvg,
} from "./useRough";

/**
 * Low-level canvas for hand-placed diagrams. Child primitives (<RoughBox>,
 * <RoughArrow>, …) register draw callbacks via inject; the canvas runs them in
 * declaration order and re-runs on theme change. Coordinates are in the
 * `width`×`height` viewBox space and scale responsively.
 */
const props = withDefaults(
  defineProps<{ width: number; height: number; caption?: string }>(),
  { caption: "" },
);

const svgRef = ref<SVGSVGElement | null>(null);
const palette = useRoughPalette();
const fns: RoughDrawFn[] = [];
let rough: ((svg: SVGSVGElement) => RoughSvg) | null = null;
let scheduled = false;

function draw(): void {
  const svg = svgRef.value;
  if (!svg || !rough) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const rc = rough(svg);
  const append = (el: SVGElement) => svg.appendChild(el);
  for (const fn of fns) fn({ rc, palette: palette.value, svg, append });
}

function scheduleRedraw(): void {
  if (scheduled || !rough) return;
  scheduled = true;
  nextTick(() => {
    scheduled = false;
    draw();
  });
}

const api: RoughCanvasApi = {
  register(fn) {
    fns.push(fn);
    scheduleRedraw();
  },
  unregister(fn) {
    const i = fns.indexOf(fn);
    if (i >= 0) fns.splice(i, 1);
    scheduleRedraw();
  },
};
provide(roughCanvasKey, api);

onMounted(async () => {
  const r = (await import("roughjs")).default;
  rough = (svg: SVGSVGElement): RoughSvg => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- roughjs ships its own RoughSVG type that is structurally incompatible with our local RoughSvg; interop requires a cast through unknown
    const instance = r.svg(svg) as unknown as RoughSvg;
    return instance;
  };
  draw();
});

watch(palette, draw, { deep: true });
</script>

<template>
  <figure class="rough-canvas">
    <svg
      ref="svgRef"
      :viewBox="`0 0 ${width} ${height}`"
      :style="{ maxWidth: `${width}px` }"
      width="100%"
      role="img"
      :aria-label="caption || 'diagram'"
    />
    <figcaption v-if="caption">{{ caption }}</figcaption>
    <!-- children only register draw callbacks; they render nothing themselves -->
    <slot />
  </figure>
</template>

<style scoped>
.rough-canvas {
  margin: 1.5rem auto;
  text-align: center;
}
.rough-canvas svg {
  height: auto;
  display: block;
  margin: 0 auto;
}
.rough-canvas figcaption {
  margin-top: 0.5rem;
  font-size: 0.85em;
  font-style: italic;
  color: var(--vp-c-text-3);
}
</style>
