import { Box, Text } from "ink";
import type { AgentState } from "@workflow/core";
import { statusGlyph, formatTokens } from "./format.js";

export interface AgentsColumnProps {
  readonly agents: readonly AgentState[];
  readonly selectedIndex: number;
  readonly focused: boolean;
  readonly phaseTitle: string;
  readonly frame: number;
  readonly maxVisible?: number;
}

export function AgentsColumn({ agents, selectedIndex, focused, phaseTitle, frame, maxVisible = 10 }: AgentsColumnProps) {
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), Math.max(0, agents.length - maxVisible)));
  const visible = agents.slice(start, start + maxVisible);
  return (
    <Box flexDirection="column" width={30} borderStyle="round" borderColor={focused ? "cyan" : "gray"} paddingX={1}>
      <Text bold>AGENTS ({phaseTitle})</Text>
      {agents.length === 0 ? <Text dimColor>not started yet</Text> : null}
      {visible.map((a, i) => {
        const index = start + i;
        return (
          <Text key={a.key} inverse={index === selectedIndex}>
            {statusGlyph(a.status, frame)} {a.label} {a.tokens > 0 ? formatTokens(a.tokens) : "—"}
          </Text>
        );
      })}
    </Box>
  );
}
