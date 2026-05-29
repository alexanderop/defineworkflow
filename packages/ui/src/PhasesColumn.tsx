import { Box, Text } from "ink";
import type { PhaseState } from "@workflow/core";
import { Spinner } from "./Spinner.js";

export interface PhasesColumnProps {
  readonly phases: readonly PhaseState[];
  readonly selectedIndex: number;
  readonly focused: boolean;
  readonly frame: number;
}

export function PhasesColumn({ phases, selectedIndex, focused, frame }: PhasesColumnProps) {
  return (
    <Box flexDirection="column" width={24} borderStyle="round" borderColor={focused ? "cyan" : "gray"} paddingX={1}>
      <Text bold>PHASES</Text>
      {phases.map((p, i) => (
        <Box key={p.title}>
          <Text inverse={i === selectedIndex}>
            {p.title} {p.done}/{p.total}{" "}
          </Text>
          {p.running > 0 ? <Spinner frame={frame} /> : null}
        </Box>
      ))}
    </Box>
  );
}
