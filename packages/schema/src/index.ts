import { z } from "zod";
import { ok, err, type Result } from "neverthrow";

export type JsonSchema = Record<string, unknown>;

export type SchemaError =
  | { readonly kind: "Conversion"; readonly cause: string }
  | { readonly kind: "Validation"; readonly issues: readonly string[] };

export function toJsonSchema(schema: z.ZodType): Result<JsonSchema, SchemaError> {
  try {
    return ok(z.toJSONSchema(schema) as JsonSchema);
  } catch (e) {
    return err({ kind: "Conversion", cause: e instanceof Error ? e.message : String(e) });
  }
}
