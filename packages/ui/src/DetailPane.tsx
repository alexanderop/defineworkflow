import { Box, Text } from "ink";
import type { AgentState } from "@workflow/core";
import { detailLines } from "./selectors.js";

export interface DetailPaneProps {
  readonly agent: AgentState | undefined;
  readonly scroll: number;
  readonly rows: number;
  readonly focused: boolean;
}

export function DetailPane({ agent, scroll, rows, focused }: DetailPaneProps) {
  const lines = agent ? detailLines(agent) : ["(no agent selected)"];
  const visible = lines.slice(scroll, scroll + rows);
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={focused ? "cyan" : "gray"} paddingX={1}>
      {visible.map((line, i) => (
        <Text key={scroll + i}>{line === "" ? " " : line}</Text>
      ))}
    </Box>
  );
}
