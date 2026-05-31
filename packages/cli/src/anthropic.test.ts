import { describe, it, expect, vi } from "vitest";

// Hoisted so the vi.mock factory (also hoisted) can reference them safely.
const h = vi.hoisted(() => ({ created: vi.fn(), nextResponse: undefined as unknown }));

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    // Accepts `{ apiKey }` via the implicit default constructor; the value is unused in tests.
    messages = {
      create: async (body: unknown) => {
        h.created(body);
        return h.nextResponse;
      },
    };
  }
  return { default: FakeAnthropic };
});

// Import AFTER the mock is registered.
const { createAnthropicComplete } = await import("./anthropic.js");

const req = (over: Record<string, unknown> = {}) => ({
  prompt: "hello",
  cwd: "/tmp",
  signal: new AbortController().signal,
  ...over,
});

describe("createAnthropicComplete", () => {
  it("returns undefined when no API key is set", () => {
    expect(createAnthropicComplete(undefined)).toBeUndefined();
  });

  it("joins only text blocks and maps SDK token fields to camelCase", async () => {
    h.nextResponse = {
      content: [
        { type: "text", text: "part one " },
        { type: "tool_use", text: "IGNORED" },
        { type: "text", text: "part two" },
      ],
      usage: { input_tokens: 12, output_tokens: 34 },
    };
    const complete = createAnthropicComplete("sk-test")!;

    const result = await complete(req());

    expect(result.text).toBe("part one part two");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 34 });
    expect(result.data).toBeUndefined(); // no schema -> no parse
  });

  it("appends the schema instruction and parses valid JSON into `data`", async () => {
    h.nextResponse = {
      content: [{ type: "text", text: `{"n": 7}` }],
      usage: { input_tokens: 1, output_tokens: 2 },
    };
    const complete = createAnthropicComplete("sk-test")!;

    const result = await complete(
      req({ schema: { type: "object", properties: { n: { type: "number" } } } }),
    );

    expect(result.data).toEqual({ n: 7 });
    // The prompt sent to the SDK carries the schema instruction.
    const body = h.created.mock.calls.at(-1)![0] as { messages: Array<{ content: string }> };
    expect(body.messages[0]!.content).toContain("Return ONLY JSON matching this schema");
  });

  it("degrades to data:undefined (does not throw) when schema output is malformed JSON", async () => {
    h.nextResponse = {
      content: [{ type: "text", text: "not json at all" }],
      usage: { input_tokens: 1, output_tokens: 2 },
    };
    const complete = createAnthropicComplete("sk-test")!;

    const result = await complete(req({ schema: { type: "object" } }));

    expect(result.text).toBe("not json at all");
    expect(result.data).toBeUndefined();
  });
});
