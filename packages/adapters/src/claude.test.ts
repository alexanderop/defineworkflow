import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { AgentProgress } from "@workflow/core";
import { createClaudeAdapter } from "./claude.js";
import { createFakeProcessRunner } from "./fake-process-runner.js";

const stream = readFileSync(new URL("../fixtures/claude-stream.ndjson", import.meta.url), "utf8");

describe("claude adapter", () => {
  it("builds stream-json argv, drives progress, and parses structured output + usage", async () => {
    const fake = createFakeProcessRunner({ claude: { stdout: stream, code: 0 } });
    const adapter = createClaudeAdapter({ processRunner: fake });
    expect(adapter.id).toBe("claude");
    expect(adapter.capabilities.toolEvents).toBe(true);

    const progress: AgentProgress[] = [];
    const res = await adapter.run(
      { prompt: "give n", schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false }, cwd: "/tmp", label: "a", signal: new AbortController().signal },
      { runId: "r", seq: 0, onProgress: (p) => progress.push(p) },
    );
    expect(res.isOk()).toBe(true);
    const r = res._unsafeUnwrap();
    expect(r.data).toEqual({ n: 7 });
    expect(r.usage.outputTokens).toBe(106);

    // Live progress was driven from the stream.
    expect(progress.filter((p) => p.tool).map((p) => p.tool!.name)).toEqual(["WebFetch", "WebSearch"]);
    expect(progress.find((p) => p.model)?.model).toBe("claude-opus-4-8[1m]");

    const argv = fake.calls()[0]!.args;
    expect(argv).toContain("-p");
    expect(argv).toContain("--output-format");
    expect(argv).toContain("stream-json");
    expect(argv).toContain("--verbose");
    expect(argv).toContain("--json-schema");
    // YOLO: headless agents must skip permission prompts so WebSearch/WebFetch work.
    expect(argv).toContain("--dangerously-skip-permissions");
    expect(argv).not.toContain("--permission-mode");
  });

  it("returns SchemaValidation when schema output is missing after retries", async () => {
    const noStructured = JSON.stringify({ type: "result", is_error: false, usage: { input_tokens: 1, output_tokens: 1 } });
    const fake = createFakeProcessRunner({ claude: { stdout: noStructured, code: 0 } });
    const adapter = createClaudeAdapter({ processRunner: fake });
    const res = await adapter.run(
      { prompt: "give n", schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false }, cwd: "/tmp", signal: new AbortController().signal },
      { runId: "r", seq: 0 },
    );
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().kind).toBe("SchemaValidation");
  });

  it("retries when Claude returns prose instead of schema JSON, then accepts valid JSON", async () => {
    const schema = { type: "object", properties: { source: { type: "string" }, items: { type: "array", items: { type: "object" } } }, required: ["source", "items"], additionalProperties: false };
    let call = 0;
    const fake = createFakeProcessRunner({
      claude: (spec) => {
        call++;
        if (call === 1) {
          return {
            stdout: JSON.stringify({
              type: "result",
              subtype: "success",
              is_error: false,
              result: "I could not find any Hacker News results in that window.",
              usage: { input_tokens: 10, output_tokens: 12 },
            }),
            code: 0,
          };
        }
        expect(spec.args.join("\n")).toMatch(/previous response did not match the required schema/i);
        return {
          stdout: JSON.stringify({
            type: "result",
            subtype: "success",
            is_error: false,
            result: '{"source":"hackernews","items":[]}',
            usage: { input_tokens: 11, output_tokens: 13 },
          }),
          code: 0,
        };
      },
    });
    const adapter = createClaudeAdapter({ processRunner: fake, maxRetries: 2 });
    const res = await adapter.run(
      { prompt: "search HN", schema, cwd: "/tmp", label: "hn", signal: new AbortController().signal },
      { runId: "r", seq: 0 },
    );
    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap().data).toEqual({ source: "hackernews", items: [] });
    expect(fake.calls()).toHaveLength(2);
  });

  it("returns an AdapterSpawn error on non-zero exit", async () => {
    const fake = createFakeProcessRunner({ claude: { stdout: "", stderr: "boom", code: 1 } });
    const adapter = createClaudeAdapter({ processRunner: fake });
    const res = await adapter.run(
      { prompt: "x", cwd: "/tmp", signal: new AbortController().signal },
      { runId: "r", seq: 0 },
    );
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().kind).toBe("AdapterSpawn");
  });
});
