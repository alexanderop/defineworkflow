import { describe, it, expect } from "vitest";
import { validate, compileValidator } from "./index.js";

const schema = {
  type: "object",
  properties: { title: { type: "string" } },
  required: ["title"],
  additionalProperties: false,
};

describe("validate", () => {
  it("returns Ok with the value on valid input", () => {
    const r = validate(schema, { title: "hi" });
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap()).toEqual({ title: "hi" });
  });

  it("returns Err with readable issues on invalid input", () => {
    const r = validate(schema, { title: 42 });
    expect(r.isErr()).toBe(true);
    const e = r._unsafeUnwrapErr();
    expect(e.kind).toBe("Validation");
    expect(e.kind === "Validation" && e.issues.length).toBeGreaterThan(0);
  });

  it("validates a draft 2020-12 schema (the shape authors copy from tooling)", () => {
    const r = validate(
      { $schema: "https://json-schema.org/draft/2020-12/schema", ...schema },
      { title: "ok" },
    );
    expect(r.isOk()).toBe(true);
  });

  it("reports a Conversion error for a malformed schema", () => {
    const r = validate({ type: "nonsense-type" }, { any: true });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().kind).toBe("Conversion");
  });
});

describe("compileValidator", () => {
  it("returns null for valid data and issue strings for invalid data", () => {
    const v = compileValidator(schema);
    expect(v({ title: "hi" })).toBeNull();
    expect(v({ title: 1 })).not.toBeNull();
  });

  it("flags missing data as an issue rather than passing", () => {
    expect(compileValidator(schema)(undefined)).not.toBeNull();
  });

  it("names the offending key for additionalProperties violations", () => {
    const issues = compileValidator(schema)({ title: "hi", vibe: "great" });
    expect(issues).not.toBeNull();
    expect(issues!.join(" ")).toContain("vibe");
  });
});
