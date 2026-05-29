import { describe, it, expect } from "vitest";
import { ok, err, type WorkflowError } from "./errors.js";

describe("errors", () => {
  it("re-exports neverthrow ok/err", () => {
    expect(ok(1).isOk()).toBe(true);
    expect(err("x").isErr()).toBe(true);
  });

  it("WorkflowError is a discriminated union matchable by kind", () => {
    const e: WorkflowError = { kind: "BudgetExhausted", spent: 10, total: 5 };
    expect(e.kind === "BudgetExhausted" && e.spent).toBe(10);
  });
});
