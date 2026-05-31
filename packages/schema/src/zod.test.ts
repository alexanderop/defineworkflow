import { describe, it, expect } from "vitest";
import { z } from "zod";
import { isZodSchema, toJsonSchema } from "./zod.js";
import { validate } from "./index.js";

describe("isZodSchema", () => {
  it("recognizes a zod schema by its parse interface", () => {
    expect(isZodSchema(z.object({ a: z.string() }))).toBe(true);
    expect(isZodSchema(z.string())).toBe(true);
  });

  it("rejects plain JSON Schema objects and non-schemas", () => {
    expect(isZodSchema({ type: "object", properties: {} })).toBe(false);
    expect(isZodSchema(null)).toBe(false);
    expect(isZodSchema(undefined)).toBe(false);
    expect(isZodSchema("string")).toBe(false);
    expect(isZodSchema(42)).toBe(false);
  });
});

describe("toJsonSchema", () => {
  it("converts a zod object schema to an equivalent JSON Schema", () => {
    const json = toJsonSchema(z.object({ title: z.string(), n: z.number() }));
    expect(json["type"]).toBe("object");
    const props = json["properties"] as Record<string, { type: string }>;
    expect(props["title"]?.type).toBe("string");
    expect(props["n"]?.type).toBe("number");
    expect(json["required"]).toEqual(["title", "n"]);
  });

  it("omits the $schema meta key (Claude Code's --json-schema silently ignores any schema that carries it)", () => {
    const json = toJsonSchema(z.object({ title: z.string() }));
    expect("$schema" in json).toBe(false);
  });

  it("produces a schema that AJV can validate real data against", () => {
    const json = toJsonSchema(
      z.object({ impact: z.enum(["high", "medium", "low"]), count: z.number() }),
    );
    expect(validate(json, { impact: "high", count: 3 }).isOk()).toBe(true);
    expect(validate(json, { impact: "nope", count: 3 }).isErr()).toBe(true);
    expect(validate(json, { count: 3 }).isErr()).toBe(true); // missing required `impact`
  });
});
