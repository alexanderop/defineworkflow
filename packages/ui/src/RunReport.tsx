import { Box, Text } from "ink";
import type { RunReport as RunReportData } from "@workflow/core";
import { renderReportText } from "./report-text.js";

export interface RunReportProps {
  readonly report: RunReportData;
  /** Cap the agent table; the rest collapse into a "+N more" line. */
  readonly maxAgents?: number;
}

/** Classify a rendered line so it can be styled without re-deriving the table layout. */
function lineKind(line: string, index: number): "title" | "rule" | "header" | "dim" | "normal" {
  if (index === 0) return "title";
  const t = line.trimStart();
  if (t.startsWith("─")) return "rule";
  if (t.startsWith("Phase") || t.startsWith("Agent ")) return "header";
  if (t.includes("(cached)") || t.startsWith("+")) return "dim";
  return "normal";
}

/**
 * Ink view of a finished run's report. Shares its layout with `renderReportText` (single source of
 * truth for the columns) and styles by line: bold title, dim rules / table headers / cached rows.
 */
export function RunReport({ report, maxAgents }: RunReportProps) {
  const lines = renderReportText(report, maxAgents !== undefined ? { maxAgents } : {}).split("\n");
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        const kind = lineKind(line, i);
        if (line === "") return <Text key={i}> </Text>;
        if (kind === "title") return <Text key={i} bold color="blueBright">{line}</Text>;
        const dim = kind === "rule" || kind === "header" || kind === "dim";
        return <Text key={i} dimColor={dim}>{line}</Text>;
      })}
    </Box>
  );
}
