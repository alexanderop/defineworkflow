import { inject, onMounted, onUnmounted } from "vue";
import { roughCanvasKey, type RoughDrawFn } from "./useRough";

/**
 * Shared wiring for <RoughCanvas> primitives: register a draw callback on mount,
 * unregister on unmount. The callback closes over the component's props, so the
 * latest values are used every time the canvas redraws (e.g. on theme change).
 */
export function usePrimitive(draw: RoughDrawFn): void {
  const canvas = inject(roughCanvasKey, null);
  if (!canvas) {
    throw new Error("Rough primitives must be used inside <RoughCanvas>.");
  }
  onMounted(() => canvas.register(draw));
  onUnmounted(() => canvas.unregister(draw));
}
