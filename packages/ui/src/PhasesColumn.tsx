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
    <Box flexDirection="column" width={24} paddingX={1}>
      <Text bold>Phases</Text>
      {phases.map((p, i) => {
        const selected = i === selectedIndex;
        const complete = p.total > 0 && p.done >= p.total && p.running === 0;
        return (
          <Box key={p.title}>
            <Text {...(selected && focused ? { color: "blueBright" as const } : {})}>{selected ? "› " : "  "}</Text>
            {p.running > 0 ? (
              <Spinner frame={frame} />
            ) : (
              <Text color={complete ? "green" : "gray"}>{complete ? "✓" : " "}</Text>
            )}
            <Text {...(selected ? { color: "blueBright" as const } : {})}>
              {" "}
              {p.title} {p.done}/{p.total}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
