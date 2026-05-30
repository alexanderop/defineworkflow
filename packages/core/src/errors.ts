export { ok, err, okAsync, errAsync } from "neverthrow";
export type { Result, ResultAsync } from "neverthrow";

export type WorkflowError =
  | { readonly kind: "AdapterSpawn"; readonly adapter: string; readonly cause: string }
  | {
      readonly kind: "SchemaValidation";
      readonly issues: readonly string[];
      readonly attempts: number;
      /** The model's actual final output from the last attempt — what failed to match the schema. */
      readonly rawOutput?: string;
    }
  | { readonly kind: "SandboxViolation"; readonly api: string }
  | { readonly kind: "JournalCorrupt"; readonly runId: string; readonly detail: string }
  | { readonly kind: "BudgetExhausted"; readonly spent: number; readonly total: number }
  | { readonly kind: "AgentCapExceeded"; readonly cap: number }
  | { readonly kind: "HarnessNotDeclared"; readonly found: string | undefined }
  | { readonly kind: "UnansweredQuestion"; readonly key: string };

/** Thrown across the sandbox boundary only; carries a typed WorkflowError. */
export class WorkflowThrow extends Error {
  constructor(readonly workflowError: WorkflowError) {
    super("cause" in workflowError ? `${workflowError.kind}: ${workflowError.cause}` : `${workflowError.kind}`);
    this.name = "WorkflowThrow";
  }
}
