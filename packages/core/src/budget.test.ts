import { describe, it, expect } from "vitest";
import { createBudget } from "./budget.js";

describe("budget", () => {
  it("tracks spend and remaining when a total is set", () => {
    const b = createBudget(100);
    expect(b.total).toBe(100);
    expect(b.remaining()).toBe(100);
    b.record(30);
    expect(b.spent()).toBe(30);
    expect(b.remaining()).toBe(70);
  });

  it("never reports negative remaining", () => {
    const b = createBudget(10);
    b.record(50);
    expect(b.remaining()).toBe(0);
  });

  it("reports Infinity remaining when total is null", () => {
    const b = createBudget(null);
    b.record(999);
    expect(b.remaining()).toBe(Infinity);
  });
});
