import { assertNever } from "./exhaustive.js";
import type { WorkflowError } from "./errors.js";

/** Render a WorkflowError as a one-line, human-readable message. */
export function formatError(error: WorkflowError): string {
  switch (error.kind) {
    case "AdapterSpawn":
      return `AdapterSpawn (${error.adapter}): ${error.cause}`;
    case "SchemaValidation": {
      const base = `SchemaValidation after ${error.attempts} attempt(s): ${error.issues.join("; ")}`;
      return error.rawOutput ? `${base}\n  model output: ${error.rawOutput}` : base;
    }
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
    case "UnansweredQuestion":
      return `UnansweredQuestion: no answer for "${error.key}" in a non-interactive run — pass --answers '{"${error.key}":"…"}' or give the question a default`;
    default:
      return assertNever(error);
  }
}
