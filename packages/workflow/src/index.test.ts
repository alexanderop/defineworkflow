import { describe, it, expect, expectTypeOf } from "vitest";
import { agent, z } from "./index.js";

describe("authoring surface", () => {
  it("re-exports the engine's zod instance", () => {
    expect(typeof z.object).toBe("function");
    expect(typeof z.string).toBe("function");
  });

  it("infers agent's return type from a zod schema", () => {
    // Compile-time assertion: only type-checks if the agent() overload infers the
    // schema's output. Never executed (the stub throws); `pnpm typecheck` is the gate.
    async function _typecheck(): Promise<void> {
      const out = await agent("p", { schema: z.object({ title: z.string(), n: z.number() }) });
      expectTypeOf(out).toEqualTypeOf<{ title: string; n: number }>();
    }
    expect(typeof _typecheck).toBe("function");
  });

  it("returns unknown when no schema is given", () => {
    async function _typecheck(): Promise<void> {
      const out = await agent("p");
      expectTypeOf(out).toBeUnknown();
    }
    expect(typeof _typecheck).toBe("function");
  });
});
