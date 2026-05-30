import { describe, expect, it } from "vitest";
import { profile, isProfile } from "./profile.js";

describe("profile()", () => {
  it("wraps a config into a branded Profile", () => {
    const p = profile({ adapter: "claude", model: "sonnet", instructions: "Review only." });
    expect(isProfile(p)).toBe(true);
    expect(p.config).toEqual({ adapter: "claude", model: "sonnet", instructions: "Review only." });
  });

  it("freezes the resolved config so it can't be mutated", () => {
    const p = profile({ model: "sonnet" });
    expect(Object.isFrozen(p.config)).toBe(true);
  });

  it("does not retain a reference to the caller's object", () => {
    const input = { model: "sonnet" };
    const p = profile(input);
    input.model = "opus";
    expect(p.config.model).toBe("sonnet");
  });
});

describe("isProfile()", () => {
  it("is false for plain objects, strings, null, and undefined", () => {
    expect(isProfile({ adapter: "claude" })).toBe(false);
    expect(isProfile("a prompt")).toBe(false);
    expect(isProfile(null)).toBe(false);
    expect(isProfile(undefined)).toBe(false);
  });
});
