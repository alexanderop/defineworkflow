import { describe, it, expect } from "vitest";
import { genRunId, slugify } from "./run-id.js";

describe("slugify", () => {
  it("lowercases and strips filesystem-unsafe characters", () => {
    expect(slugify("Deep Research!")).toBe("deep-research");
    expect(slugify("a/b\\c:d")).toBe("a-b-c-d");
    expect(slugify("")).toBe("workflow");
  });

  it("trims leading and trailing separators", () => {
    expect(slugify("!!!hello!!!")).toBe("hello");
    expect(slugify("---")).toBe("workflow");
  });

  // Regression: the dash-trim regex must stay linear. A long run of separators
  // fed a polynomial-backtracking `^-+|-+$` and could hang (ReDoS).
  it("handles a long run of separators in linear time", () => {
    const start = performance.now();
    expect(slugify("!".repeat(100_000) + "a")).toBe("a");
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("genRunId", () => {
  it("is deterministic given injected clock and rand", () => {
    const id = genRunId("Deep Research", { now: () => 0, rand: () => 0 });
    const id2 = genRunId("Deep Research", { now: () => 0, rand: () => 0 });
    expect(id).toBe(id2);
    expect(id.startsWith("deep-research-")).toBe(true);
  });

  it("varies with the clock", () => {
    const a = genRunId("x", { now: () => 1, rand: () => 0.5 });
    const b = genRunId("x", { now: () => 2, rand: () => 0.5 });
    expect(a).not.toBe(b);
  });

  it("produces a filesystem-safe id", () => {
    const id = genRunId("my workflow", { now: () => 123456, rand: () => 0.987 });
    expect(id).toMatch(/^[a-z0-9-]+$/);
  });
});
