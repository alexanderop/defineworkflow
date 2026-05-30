import { Box, Text } from "ink";
import type { AgentState } from "@workflow/core";
import { detailSections } from "./selectors.js";

export interface DetailPaneProps {
  readonly agent: AgentState | undefined;
  readonly scroll: number;
  readonly rows: number;
  readonly focused: boolean;
  readonly now: number;
  readonly expanded: boolean;
}

export function DetailPane({ agent, scroll, rows, focused, now, expanded }: DetailPaneProps) {
  const lines = agent ? detailSections(agent, now, expanded) : ["(no agent selected)"];
  const total = lines.length;
  const scrollable = total > rows;
  // Reserve one row for the scroll indicator when the content overflows the budget.
  const contentRows = scrollable ? rows - 1 : rows;
  const visible = lines.slice(scroll, scroll + contentRows);
  const end = Math.min(scroll + contentRows, total);
  const indicator = scrollable ? `${scroll + 1}–${end} of ${total} ↓` : undefined;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {visible.map((line, i) => (
        <Text key={scroll + i} wrap="truncate" {...(focused && i === 0 ? { color: "green" as const } : {})}>
          {line === "" ? " " : line}
        </Text>
      ))}
      {indicator ? (
        <Box justifyContent="flex-end">
          <Text dimColor>{indicator}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
