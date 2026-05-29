import { describe, it, expect } from "vitest";
import { z } from "zod";
import { toJsonSchema } from "./index.js";

describe("toJsonSchema", () => {
  it("converts a zod object to a JSON Schema with properties", () => {
    const schema = z.object({ title: z.string(), count: z.number() });
    const result = toJsonSchema(schema);
    expect(result.isOk()).toBe(true);
    const json = result._unsafeUnwrap();
    expect(json.type).toBe("object");
    expect(Object.keys(json.properties as object)).toEqual(["title", "count"]);
  });
});
