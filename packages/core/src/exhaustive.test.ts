import { describe, expect, it } from "vitest";
import { assertNever } from "./exhaustive.js";

describe("assertNever", () => {
  it("throws when an unreachable branch is reached at runtime", () => {
    expect(() => assertNever("future-case" as never)).toThrow("Unhandled switch case");
  });
});
