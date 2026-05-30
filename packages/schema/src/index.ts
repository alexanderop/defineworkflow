import Ajv2020 from "ajv/dist/2020.js";
import { ok, err, type Result } from "neverthrow";

/**
 * A workflow's `agent({ schema })` is a plain JSON Schema object — the same shape
 * the harness CLIs consume (`claude --json-schema`, codex's schema file) and the
 * serializable form that crosses the vm-sandbox / process boundaries. This package
 * is the single home for validating model output against that schema.
 */
export type JsonSchema = Record<string, unknown>;

export { isZodSchema, toJsonSchema } from "./zod.js";

export type SchemaError =
  | { readonly kind: "Conversion"; readonly cause: string }
  | { readonly kind: "Validation"; readonly issues: readonly string[] };

/** Validates parsed data against a schema; returns issue strings on failure, or null when valid. */
export type Validator = (data: unknown) => readonly string[] | null;

/**
 * Compile a JSON Schema into a reusable validator. Uses the 2020-12 Ajv build because
 * that's the draft most schema tooling (incl. zod's `toJSONSchema`) emits — the default
 * draft-07 Ajv throws "no schema with key or ref .../draft/2020-12/schema" on those.
 */
export function compileValidator(schema: JsonSchema): Validator {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validateFn = ajv.compile(schema);
  return (data: unknown): readonly string[] | null => {
    if (data === undefined) return ["no JSON value found in output"];
    const valid = validateFn(data);
    if (valid) return null;
    return (validateFn.errors ?? []).map((e) => {
      const where = e.instancePath || "(root)";
      // Ajv's "must NOT have additional properties" message omits the offending key;
      // surface it (it lives in params) so weak-model debugging shows what to drop.
      const params: { additionalProperty?: string } | undefined = e.params;
      const offending = params?.additionalProperty;
      const suffix = offending !== undefined ? ` "${offending}"` : "";
      return `${where} ${e.message ?? "invalid"}${suffix}`;
    });
  };
}

/** Validate a value against a JSON Schema. A malformed schema surfaces as a `Conversion` error. */
export function validate(schema: JsonSchema, value: unknown): Result<unknown, SchemaError> {
  let issues: readonly string[] | null;
  try {
    issues = compileValidator(schema)(value);
  } catch (e) {
    return err({ kind: "Conversion", cause: e instanceof Error ? e.message : String(e) });
  }
  if (issues === null) return ok(value);
  return err({ kind: "Validation", issues });
}
