import { Box, Text } from "ink";
import type { RunState } from "@workflow/core";
import { formatDuration } from "./format.js";

export interface HeaderProps {
  readonly state: RunState;
  /** Run elapsed in ms (now − startedAt while running; frozen after). */
  readonly elapsedMs: number;
  readonly description?: string | undefined;
  readonly adapter?: string | undefined;
}

export function Header({ state, elapsedMs, description, adapter }: HeaderProps) {
  const name = state.name || "workflow";
  const agents = [...state.agents.values()];
  const total = agents.length;
  const done = agents.filter((a) => a.status === "done").length;
  const finished = state.status === "finished";

  const counts = `${done}/${total} agent${total === 1 ? "" : "s"}`;
  const right = `${counts} · ${formatDuration(elapsedMs)}${finished ? " · done" : ""}${adapter ? ` · ${adapter}` : ""}`;

  return (
    <Box borderStyle="round" paddingX={1} flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold>{name}</Text>
        <Text>{right}</Text>
      </Box>
      {description ? (
        <Text dimColor wrap="truncate">
          {description}
        </Text>
      ) : null}
    </Box>
  );
}
