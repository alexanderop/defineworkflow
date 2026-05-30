import { z } from "zod";
import type { JsonSchema } from "./index.js";

/**
 * Duck-type a zod schema by its parse interface rather than `instanceof`, so it holds
 * across realm boundaries (the workflow sandbox injects its own zod instance). A plain
 * JSON Schema object has no `parse`/`safeParse`, so the two inputs are unambiguous.
 */
export function isZodSchema(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { parse?: unknown }).parse === "function" &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

/**
 * Convert a zod schema to the plain JSON Schema the rest of the engine speaks (the
 * serializable form harness CLIs consume and AJV validates). zod v4 emits 2020-12,
 * which is exactly the draft {@link compileValidator} compiles against.
 */
export function toJsonSchema(schema: unknown): JsonSchema {
  return z.toJSONSchema(schema as Parameters<typeof z.toJSONSchema>[0]) as JsonSchema;
}
