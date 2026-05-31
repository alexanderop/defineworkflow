import { compileValidator, type JsonSchema } from "@workflow/schema";
import type { Validator } from "./coercion.js";

/** Extract a JSON value from CLI text: prefer a ```json fenced block, else the first balanced {...} or [...]. */
export function extractJson(text: string): unknown {
  // No `\s*` before the lazy body: a whitespace quantifier feeding a `[\s\S]*?`
  // backtracks polynomially on an unterminated fence (ReDoS). Any leading
  // whitespace stays in the capture and is skipped by the `search(/[[{]/)` below.
  const fenced = /```(?:json)?([\s\S]*?)```/.exec(text);
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
