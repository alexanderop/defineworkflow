import { describe, it, expect, expectTypeOf } from "vitest";
import { agent, pipeline, z } from "./index.js";

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

  it("rejects a plain JSON Schema object as a type error", () => {
    async function _typecheck(): Promise<void> {
      // @ts-expect-error a plain JSON Schema object is no longer assignable to schema (zod-only)
      await agent("p", { schema: { type: "object", properties: {} } });
    }
    expect(typeof _typecheck).toBe("function");
  });
});

describe("pipeline typing", () => {
  it("infers each stage's prev from the prior stage's return (2 stages)", () => {
    async function _typecheck(): Promise<void> {
      const out = await pipeline(
        [1, 2, 3],
        async (prev, item, index) => {
          expectTypeOf(prev).toBeNumber();
          expectTypeOf(item).toBeNumber();
          expectTypeOf(index).toBeNumber();
          return `s1:${prev}`;
        },
        async (prev) => {
          expectTypeOf(prev).toBeString();
          return prev.length;
        },
      );
      expectTypeOf(out).toEqualTypeOf<Array<number | null>>();
    }
    expect(typeof _typecheck).toBe("function");
  });

  it("threads the item type through 3 stages and yields Array<Last | null>", () => {
    async function _typecheck(): Promise<void> {
      const out = await pipeline(
        ["a", "b"],
        async (prev) => prev.length,
        async (prev) => prev > 0,
        async (prev): Promise<{ ok: boolean } | null> => {
          expectTypeOf(prev).toBeBoolean();
          return prev ? { ok: prev } : null;
        },
      );
      expectTypeOf(out).toEqualTypeOf<Array<{ ok: boolean } | null>>();
    }
    expect(typeof _typecheck).toBe("function");
  });
});
