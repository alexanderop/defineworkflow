import { describe, expect, it, expectTypeOf } from "vitest";
import { agent, profile, z } from "./index.js";
import type { Profile } from "./index.js";

describe("profile (authoring)", () => {
  it("creates a profile from a config", () => {
    const reviewer = profile({ adapter: "claude", model: "sonnet", instructions: "Review only." });
    expect(reviewer.config).toEqual({ adapter: "claude", model: "sonnet", instructions: "Review only." });
  });

  it("rejects per-call fields at the type level", () => {
    // @ts-expect-error schema is a per-call field, not allowed in a profile
    profile({ model: "sonnet", schema: z.object({ n: z.number() }) });
    // @ts-expect-error label is a per-call field, not allowed in a profile
    profile({ model: "sonnet", label: "x" });
  });

  it("lets agent() take a profile as its first argument", () => {
    const reviewer: Profile = profile({ model: "sonnet" });
    expectTypeOf(agent).toBeCallableWith(reviewer, "prompt");
    expectTypeOf(agent).toBeCallableWith(reviewer, "prompt", { label: "x" });
  });

  it("infers the schema output type when called with a profile", () => {
    const reviewer = profile({ model: "sonnet" });
    const typecheck = () => agent(reviewer, "p", { schema: z.object({ n: z.number() }) });
    expectTypeOf(typecheck).returns.resolves.toEqualTypeOf<{ n: number }>();
  });
});
