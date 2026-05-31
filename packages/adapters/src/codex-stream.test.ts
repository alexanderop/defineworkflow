import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { AgentProgress } from "@workflow/core";
import { createCodexTranslator } from "./codex-stream.js";

const fixture = readFileSync(new URL("../fixtures/codex-stream.ndjson", import.meta.url), "utf8");

function drive(
  translator: ReturnType<typeof createCodexTranslator>,
  text: string,
): AgentProgress[] {
  const out: AgentProgress[] = [];
  for (const line of text.split("\n")) for (const p of translator.push(line)) out.push(p);
  return out;
}

describe("codex stream translator", () => {
  it("extracts model, tool calls, final text and real usage from the fixture", () => {
    const t = createCodexTranslator();
    const progress = drive(t, fixture);

    expect(progress.find((p) => p.model)?.model).toBe("gpt-5-codex");
    expect(progress.filter((p) => p.tool).map((p) => p.tool!.name)).toEqual(["Shell", "Mcp"]);
    expect(progress.filter((p) => p.tokens !== undefined).map((p) => p.tokens)).toEqual([256]);

    const final = t.result();
    expect(final.text).toBe('{"n": 7}');
    expect(final.usage).toEqual({ inputTokens: 2048, outputTokens: 256 });
  });

  it("accumulates usage across multiple turn.completed events", () => {
    const t = createCodexTranslator();
    const progress = drive(
      t,
      '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":100}}\n' +
        '{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":150}}',
    );
    expect(progress.filter((p) => p.tokens !== undefined).map((p) => p.tokens)).toEqual([100, 250]);
    expect(t.result().usage).toEqual({ inputTokens: 15, outputTokens: 250 });
  });

  it("skips thread/turn noise and non-tool items", () => {
    const t = createCodexTranslator();
    expect(t.push('{"type":"turn.started"}')).toEqual([]);
    expect(t.push('{"type":"item.completed","item":{"type":"reasoning"}}')).toEqual([]);
  });
});
