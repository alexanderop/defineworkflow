import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { extractJson, compileJsonSchemaValidator } from "./json.js";

describe("extractJson", () => {
  it("pulls JSON out of a fenced code block", () => {
    expect(extractJson('text\n```json\n{"n":7}\n```\nmore')).toEqual({ n: 7 });
  });
  it("pulls bare JSON object from surrounding prose", () => {
    expect(extractJson('Sure! {"n": 8} done')).toEqual({ n: 8 });
  });
  it("returns undefined when no JSON present", () => {
    expect(extractJson("no json here")).toBeUndefined();
  });

  // Regression: the fenced-block regex must stay linear. An unterminated fence
  // followed by a long whitespace run fed a polynomial-backtracking
  // `\s*([\s\S]*?)` and could hang (ReDoS).
  it("handles an unterminated fence with a long whitespace run in linear time", () => {
    const start = performance.now();
    expect(extractJson("```json" + " ".repeat(100_000) + "x")).toBeUndefined();
    expect(performance.now() - start).toBeLessThan(1000);
  });

  // Property-based: extractJson is a pure parser, so its guarantees should hold for arbitrary input.
  // We only fuzz arrays/objects because that's what extractJson scans for ([ or { is the entry point),
  // and we compare via JSON.stringify so the round-trip is insensitive to -0 and key ordering.
  const jsonContainer = fc.oneof(
    fc.array(fc.jsonValue()),
    fc.dictionary(fc.string(), fc.jsonValue()),
  );
  // Surrounding prose must not contain a code fence, or it would create a competing/earlier fence match.
  const prose = fc.string().filter((s) => !s.includes("```"));

  it("round-trips a JSON container embedded in a fenced block", () => {
    fc.assert(
      fc.property(jsonContainer, prose, prose, (value, before, after) => {
        const text = `${before}\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n${after}`;
        expect(JSON.stringify(extractJson(text))).toBe(JSON.stringify(value));
      }),
    );
  });

  it("recovers a bare JSON container with no surrounding prose", () => {
    fc.assert(
      fc.property(jsonContainer, (value) => {
        expect(JSON.stringify(extractJson(JSON.stringify(value)))).toBe(JSON.stringify(value));
      }),
    );
  });

  it("soundness: any non-undefined result is itself valid JSON", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = extractJson(text);
        if (result !== undefined) {
          expect(() => JSON.stringify(result)).not.toThrow();
        }
      }),
    );
  });

  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => extractJson(text)).not.toThrow();
      }),
    );
  });
});

describe("compileJsonSchemaValidator", () => {
  const schema = {
    type: "object",
    properties: { n: { type: "number" } },
    required: ["n"],
    additionalProperties: false,
  };
  it("returns null for valid data", () => {
    expect(compileJsonSchemaValidator(schema)({ n: 7 })).toBeNull();
  });
  it("returns issue strings for invalid data", () => {
    const issues = compileJsonSchemaValidator(schema)({ n: "x" });
    expect(issues).not.toBeNull();
    expect((issues ?? []).length).toBeGreaterThan(0);
  });
  it("compiles a draft 2020-12 schema (the shape z.toJSONSchema emits)", () => {
    const schema2020 = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { n: { type: "number" } },
      required: ["n"],
      additionalProperties: false,
    };
    const validate = compileJsonSchemaValidator(schema2020);
    expect(validate({ n: 7 })).toBeNull();
    expect(validate({ n: "x" })).not.toBeNull();
  });
});
