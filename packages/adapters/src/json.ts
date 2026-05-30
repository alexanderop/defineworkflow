import { compileValidator, type JsonSchema } from "@workflow/schema";
import type { Validator } from "./coercion.js";

/** Extract a JSON value from CLI text: prefer a ```json fenced block, else the first balanced {...} or [...]. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) return undefined;
  for (let end = candidate.length; end > start; end--) {
    const slice = candidate.slice(start, end);
    try {
      const parsed: unknown = JSON.parse(slice);
      return parsed;
    } catch {
      // shrink the window and retry
    }
  }
  return undefined;
}

/** Compile a JSON Schema into the `Validator` shape the coercion loop expects. */
export function compileJsonSchemaValidator(schema: JsonSchema): Validator {
  return compileValidator(schema);
}
