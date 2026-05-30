import type { NavAction, FocusColumn } from "./navigation.js";

export type UiAction =
  | { readonly type: "pause" }
  | { readonly type: "stop"; readonly target: { readonly scope: "run" } | { readonly scope: "agent"; readonly key: string } }
  | { readonly type: "restart"; readonly key: string }
  | { readonly type: "save" }
  | { readonly type: "answer"; readonly key: string; readonly value: string };

/** A resolved keypress: either a navigation action (applied via navReducer) or a UI control action. */
export type KeyIntent =
  | { readonly kind: "nav"; readonly action: NavAction }
  | { readonly kind: "ui"; readonly action: UiAction };

/** The subset of Ink's `Key` that the keymap inspects. Ink's full `Key` is structurally assignable. */
export interface KeyInput {
  readonly upArrow?: boolean;
  readonly downArrow?: boolean;
  readonly leftArrow?: boolean;
  readonly rightArrow?: boolean;
  readonly escape?: boolean;
  readonly return?: boolean;
}

export interface KeymapCtx {
  readonly focus: FocusColumn;
  /** Key of the currently selected agent, if any — required for agent-scoped stop/restart. */
  readonly agentKey?: string | undefined;
}

const nav = (action: NavAction): KeyIntent => ({ kind: "nav", action });
const ui = (action: UiAction): KeyIntent => ({ kind: "ui", action });

/**
 * Map a keypress to a UI intent during normal navigation. Returns null for unmapped keys.
 * Pure and Ink-free so the full key table is unit-testable without rendering.
 */
export function resolveKey(input: string, key: KeyInput, ctx: KeymapCtx): KeyIntent | null {
  if (key.upArrow) return nav({ type: "up" });
  if (key.downArrow) return nav({ type: "down" });
  if (key.rightArrow) return nav({ type: "right" });
  if (key.leftArrow) return nav({ type: "left" });
  if (key.escape) return nav({ type: "esc" });
  if (key.return) return nav({ type: "toggleExpand" });
  if (input === "j") return nav({ type: "scrollDown" });
  if (input === "k") return nav({ type: "scrollUp" });
  if (input === "p") return ui({ type: "pause" });
  if (input === "x")
    return ctx.focus !== "phases" && ctx.agentKey
      ? ui({ type: "stop", target: { scope: "agent", key: ctx.agentKey } })
      : ui({ type: "stop", target: { scope: "run" } });
  if (input === "r") return ctx.agentKey ? ui({ type: "restart", key: ctx.agentKey }) : null;
  if (input === "s") return ui({ type: "save" });
  return null;
}
