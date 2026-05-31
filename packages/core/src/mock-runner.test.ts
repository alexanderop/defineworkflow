import { describe, it, expect } from "vitest";
import type { RunId } from "./brand.js";
import { validate } from "@workflow/schema";
import { createMockRunner } from "./mock-runner.js";
import type { AgentRequest, RunCtx } from "./types.js";

const ctx: RunCtx = { runId: "r" as RunId, seq: 0 };
const req = (over: Partial<AgentRequest> = {}): AgentRequest => ({
  prompt: "do a thing",
  cwd: "/tmp",
  signal: new AbortController().signal,
  ...over,
});

describe("createMockRunner", () => {
  it("returns an ok result with a non-empty text echo and no real tokens spent", async () => {
    const runner = createMockRunner();
    const result = await runner.run(req({ label: "writer" }), ctx);
    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.text).toContain("mock");
    expect(value.text).toContain("writer");
    expect(value.usage.outputTokens).toBe(0);
  });

  it("synthesizes data that passes validation for an object schema with required fields", async () => {
    const schema = {
      type: "object",
      properties: {
        title: { type: "string" },
        count: { type: "number" },
        ok: { type: "boolean" },
      },
      required: ["title", "count", "ok"],
      additionalProperties: false,
    };
    const runner = createMockRunner();
    const value = (await runner.run(req({ schema }), ctx))._unsafeUnwrap();
    expect(validate(schema, value.data).isOk()).toBe(true);
  });

  it("uses the first enum value for enum fields", async () => {
    const schema = {
      type: "object",
      properties: { impact: { type: "string", enum: ["high", "medium", "low"] } },
      required: ["impact"],
      additionalProperties: false,
    };
    const runner = createMockRunner();
    const value = (await runner.run(req({ schema }), ctx))._unsafeUnwrap();
    expect((value.data as { impact: string }).impact).toBe("high");
    expect(validate(schema, value.data).isOk()).toBe(true);
  });

  it("synthesizes nested arrays of objects that validate", async () => {
    const schema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { url: { type: "string" } },
            required: ["url"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    };
    const runner = createMockRunner();
    const value = (await runner.run(req({ schema }), ctx))._unsafeUnwrap();
    const data = value.data as { items: Array<{ url: string }> };
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBeGreaterThan(0);
    expect(validate(schema, value.data).isOk()).toBe(true);
  });

  it("emits enough array elements to satisfy minItems", async () => {
    const schema = {
      type: "object",
      properties: {
        angles: {
          type: "array",
          minItems: 3,
          maxItems: 6,
          items: {
            type: "object",
            properties: { label: { type: "string" } },
            required: ["label"],
            additionalProperties: false,
          },
        },
      },
      required: ["angles"],
      additionalProperties: false,
    };
    const runner = createMockRunner();
    const value = (await runner.run(req({ schema }), ctx))._unsafeUnwrap();
    const data = value.data as { angles: Array<{ label: string }> };
    expect(data.angles.length).toBe(3);
    expect(validate(schema, value.data).isOk()).toBe(true);
  });

  it("advertises a mock id and native schema capability", () => {
    const runner = createMockRunner();
    expect(runner.id).toBe("mock");
    expect(runner.capabilities.nativeSchema).toBe(true);
  });
});
