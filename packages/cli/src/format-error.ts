import type { WorkflowError } from "@workflow/core";

/** Render a WorkflowError as a one-line, human-readable message for the CLI. */
export function formatError(error: WorkflowError): string {
  switch (error.kind) {
    case "AdapterSpawn":
      return `AdapterSpawn (${error.adapter}): ${error.cause}`;
    case "SchemaValidation":
      return `SchemaValidation after ${error.attempts} attempt(s): ${error.issues.join("; ")}`;
    case "SandboxViolation":
      return `SandboxViolation: ${error.api}`;
    case "JournalCorrupt":
      return `JournalCorrupt (${error.runId}): ${error.detail}`;
    case "BudgetExhausted":
      return `BudgetExhausted: spent ${error.spent} of ${error.total}`;
    case "AgentCapExceeded":
      return `AgentCapExceeded: cap ${error.cap}`;
    case "HarnessNotDeclared":
      return error.found === undefined
        ? `HarnessNotDeclared: meta.harness is required — declare one of "claude" | "codex" | "copilot" | "raw-api"`
        : `HarnessNotDeclared: unknown harness ${JSON.stringify(error.found)} — use one of "claude" | "codex" | "copilot" | "raw-api"`;
  }
}
