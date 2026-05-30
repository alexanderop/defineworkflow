import { z } from "zod";
import type { JsonSchema } from "./index.js";

/**
 * Duck-type a zod schema by its parse interface rather than `instanceof`, so it holds
 * across realm boundaries (the workflow sandbox injects its own zod instance). A plain
 * JSON Schema object has no `parse`/`safeParse`, so the two inputs are unambiguous.
 */
export function isZodSchema(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate: { parse?: unknown; safeParse?: unknown } = value;
  return typeof candidate.parse === "function" && typeof candidate.safeParse === "function";
}

/**
 * Convert a zod schema to the plain JSON Schema the rest of the engine speaks (the
 * serializable form harness CLIs consume and AJV validates). zod v4 emits 2020-12,
 * which is exactly the draft {@link compileValidator} compiles against.
 */
export function toJsonSchema(schema: unknown): JsonSchema {
  // `schema` is `unknown` (callers pass a duck-typed zod schema via `isZodSchema`); zod's own
  // overloads can't narrow it, so this one cast to the input type is unavoidable.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow unknown to zod's input type
  const input = schema as Parameters<typeof z.toJSONSchema>[0];
  const out: JsonSchema = z.toJSONSchema(input);
  return out;
}
