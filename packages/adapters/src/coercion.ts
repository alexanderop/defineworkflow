import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import { truncateRawOutput, type WorkflowError } from "@workflow/core";

export interface Attempt {
  readonly text: string;
  readonly data: unknown;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

/** Validates parsed data; returns issue strings on failure, or null when valid. */
export type Validator = (data: unknown) => readonly string[] | null;

export interface CoercionSpec {
  readonly validate: Validator | undefined;
  readonly maxRetries: number;
  attempt(retryHint: string | undefined): Promise<Attempt>;
}

export interface CoercedResult {
  readonly text: string;
  readonly data: unknown;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

export async function runWithSchemaRetry(
  spec: CoercionSpec,
): Promise<Result<CoercedResult, WorkflowError>> {
  const { validate } = spec;
  let hint: string | undefined;
  let lastIssues: readonly string[] = [];
  let lastText = "";
  const attempts = Math.max(1, spec.maxRetries);

  for (let i = 0; i < attempts; i++) {
    const a = await spec.attempt(hint);
    if (!validate) {
      return ok({ text: a.text, data: a.data, usage: a.usage });
    }
    const issues = validate(a.data);
    if (issues === null) {
      return ok({ text: a.text, data: a.data, usage: a.usage });
    }
    lastIssues = issues;
    lastText = a.text;
    hint = `Your previous response did not match the required schema. Issues: ${issues.join("; ")}. Return ONLY valid JSON matching the schema.`;
  }

  // Surface what the model actually returned so a schema miss is debuggable
  // (especially weaker models that answer in prose instead of JSON).
  return err({
    kind: "SchemaValidation",
    issues: lastIssues,
    attempts,
    rawOutput: truncateRawOutput(lastText),
  });
}
