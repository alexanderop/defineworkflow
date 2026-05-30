import { assertNever, formatError, type WorkflowEvent } from "@workflow/core";

/**
 * A stateful non-TTY line formatter. Unlike a pure per-event mapper it can:
 * - resolve an agent's friendly `label` (carried only on `agent-queued`) so
 *   started/finished/failed lines show "draft:release" instead of the internal
 *   composite key "0:Draft:draft:release";
 * - dedupe phase headers (phases are seeded up front by the orchestrator and then
 *   re-emitted when `phase()` actually runs — the TUI reducer dedupes, this must too);
 * - append elapsed seconds, measured from the agent's `agent-started`.
 * Returns the line to write, or null for events that don't warrant one. Create one
 * logger per run and feed it every event in order.
 */
export function createLineLogger(): (event: WorkflowEvent) => string | null {
  const labels = new Map<string, string>();
  const startedAt = new Map<string, number>();
  const seenPhases = new Set<string>();
  const nameOf = (key: string): string => labels.get(key) ?? key;

  return (event: WorkflowEvent): string | null => {
    switch (event.type) {
      case "run-started":
        return `▶ ${event.name} (${event.runId})`;
      case "phase-started":
        if (seenPhases.has(event.phase)) return null;
        seenPhases.add(event.phase);
        return `# ${event.phase}`;
      case "agent-queued":
        labels.set(event.key, event.label);
        return null;
      case "agent-started":
        startedAt.set(event.key, event.at);
        return `  … ${nameOf(event.key)}`;
      case "agent-finished": {
        const started = startedAt.get(event.key);
        const secs = started !== undefined ? Math.round((event.at - started) / 1000) : 0;
        const elapsed = secs > 0 ? ` · ${secs}s` : "";
        return `  ✓ ${nameOf(event.key)} (${event.usage.outputTokens} tok${event.cached ? ", cached" : ""}${elapsed})`;
      }
      case "agent-failed":
        return `  ✗ ${nameOf(event.key)}: ${formatError(event.error)}`;
      case "question-asked": {
        const firstLine = event.question.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
        return `? ${event.key}: ${firstLine}`;
      }
      case "question-answered":
        return `  ↳ ${event.answer}`;
      case "log":
        return `  ${event.message}`;
      case "run-finished":
        return "■ done";
      case "agent-output":
      case "agent-tool":
      case "agent-progress":
        return null;
      default:
        return assertNever(event);
    }
  };
}
