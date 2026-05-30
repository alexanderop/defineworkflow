import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { AgentProgress } from "@workflow/core";
import { createClaudeTranslator } from "./claude-stream.js";

const fixture = readFileSync(new URL("../fixtures/claude-stream.ndjson", import.meta.url), "utf8");

function drive(translator: ReturnType<typeof createClaudeTranslator>, text: string): AgentProgress[] {
  const out: AgentProgress[] = [];
  for (const line of text.split("\n")) for (const p of translator.push(line)) out.push(p);
  return out;
}

describe("claude stream translator", () => {
  it("extracts model, tool calls, rising tokens, and final structured output from the fixture", () => {
    const t = createClaudeTranslator();
    const progress = drive(t, fixture);

    expect(progress.find((p) => p.model)?.model).toBe("claude-opus-4-8[1m]");
    expect(progress.filter((p) => p.tool).map((p) => p.tool!.name)).toEqual(["WebFetch", "WebSearch"]);
    // Cumulative across assistant messages: 120, then 120+340.
    expect(progress.filter((p) => p.tokens !== undefined).map((p) => p.tokens)).toEqual([120, 460]);

    const final = t.result();
    expect(final.text).toBe('{"n": 7}');
    expect(final.data).toEqual({ n: 7 });
    expect(final.usage).toEqual({ inputTokens: 10406, outputTokens: 106 });
    expect(final.isError).toBeUndefined();
  });

  it("skips noise and non-JSON lines without throwing", () => {
    const t = createClaudeTranslator();
    expect(t.push("not json")).toEqual([]);
    expect(t.push('{"type":"notification"}')).toEqual([]);
    expect(t.push("")).toEqual([]);
  });

  it("flags is_error from the result event", () => {
    const t = createClaudeTranslator();
    t.push('{"type":"result","is_error":true,"result":"nope","usage":{"input_tokens":1,"output_tokens":1}}');
    expect(t.result().isError).toBe(true);
  });
});
