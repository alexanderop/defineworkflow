import { Box, Text } from "ink";
import type { AgentState } from "@workflow/core";
import { statusGlyph } from "./format.js";
import { agentRow } from "./selectors.js";

export interface AgentsColumnProps {
  readonly agents: readonly AgentState[];
  readonly selectedIndex: number;
  readonly focused: boolean;
  readonly phaseTitle: string;
  readonly frame: number;
  readonly now: number;
  readonly maxVisible?: number;
}

export function AgentsColumn({
  agents,
  selectedIndex,
  focused,
  phaseTitle,
  frame,
  now,
  maxVisible = 10,
}: AgentsColumnProps) {
  const start = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(maxVisible / 2), Math.max(0, agents.length - maxVisible)),
  );
  const visible = agents.slice(start, start + maxVisible);
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold>
        {phaseTitle} · {agents.length} agent{agents.length === 1 ? "" : "s"}
      </Text>
      {agents.length === 0 ? <Text dimColor>not started yet</Text> : null}
      {visible.map((a, i) => {
        const index = start + i;
        const row = agentRow(a, now);
        const glyph = statusGlyph(a.status, frame);
        const metrics = [
          row.tokens ? `${row.tokens} tok` : "",
          row.toolCount > 0 ? `${row.toolCount} tools` : "",
          row.elapsed,
        ]
          .filter((s) => s !== "")
          .join(" · ");
        return (
          <Box key={a.key} justifyContent="space-between">
            <Text
              {...(index === selectedIndex && focused ? { color: "blueBright" as const } : {})}
              wrap="truncate"
            >
              {index === selectedIndex ? "›" : " "}{" "}
              <Text {...(a.status === "done" ? { color: "green" as const } : {})}>{glyph}</Text>{" "}
              {row.label}
            </Text>
            <Text dimColor wrap="truncate">
              {row.model}
            </Text>
            <Text dimColor>{metrics}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
