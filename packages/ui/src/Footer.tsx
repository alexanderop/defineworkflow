import { Text } from "ink";
import type { FocusColumn } from "./navigation.js";

export interface FooterProps {
  readonly focus: FocusColumn;
}

const LIST_KEYS = "↑↓ select · x stop workflow · p pause · esc back · s save";
const DETAIL_KEYS = "↑↓ / j k scroll · ↵ prompt · esc back · s save";

/** Contextual key hints: list level vs. the agent detail pane. */
export function Footer({ focus }: FooterProps) {
  return <Text dimColor>{focus === "detail" ? DETAIL_KEYS : LIST_KEYS}</Text>;
}
