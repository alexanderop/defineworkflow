import { describe, it, expect } from "vitest";
import { formatError } from "./format-error.js";

describe("formatError", () => {
  it("renders SchemaValidation with its issues", () => {
    const msg = formatError({
      kind: "SchemaValidation",
      issues: ["/pop must be number"],
      attempts: 2,
    });
    expect(msg).toContain("2 attempt(s)");
    expect(msg).toContain("/pop must be number");
  });

  it("includes the model's actual output when present", () => {
    const msg = formatError({
      kind: "SchemaValidation",
      issues: ["no JSON value found in output"],
      attempts: 2,
      rawOutput: "The capital of Japan is Tokyo.",
    });
    expect(msg).toContain("no JSON value found in output");
    expect(msg).toContain("The capital of Japan is Tokyo.");
  });
});
