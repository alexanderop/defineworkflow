import { describe, it, expect } from "vitest";
import type { RunId } from "@workflow/core";
import { readFileSync } from "node:fs";
import type { AgentProgress } from "@workflow/core";
import { createCodexAdapter } from "./codex.js";
import { createFakeProcessRunner } from "./fake-process-runner.js";

const stream = readFileSync(new URL("../fixtures/codex-stream.ndjson", import.meta.url), "utf8");

const stubFileStore = () => {
  const files = new Map<string, string>();
  return {
    writeTemp: async (name: string, content: string) => { const p = `/tmp/${name}`; files.set(p, content); return p; },
    read: async (p: string) => files.get(p) ?? "",
    cleanup: async () => {},
  };
};

describe("codex adapter", () => {
  it("streams exec --json, writes a schema file, parses the final message + real usage, drives progress", async () => {
    const fake = createFakeProcessRunner({ codex: { stdout: stream, code: 0 } });
    const adapter = createCodexAdapter({ processRunner: fake, fileStore: stubFileStore() });
    expect(adapter.id).toBe("codex");

    const progress: AgentProgress[] = [];
    const res = await adapter.run(
      { prompt: "give n", schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false }, cwd: "/tmp", label: "a", signal: new AbortController().signal },
      { runId: "r" as RunId, seq: 0, onProgress: (p) => progress.push(p) },
    );
    expect(res.isOk()).toBe(true);
    const r = res._unsafeUnwrap();
    expect(r.data).toEqual({ n: 7 });
    expect(r.usage.outputTokens).toBe(256);
    expect(r.usage.approximate).toBeUndefined();

    expect(progress.filter((p) => p.tool).map((p) => p.tool!.name)).toEqual(["Shell", "Mcp"]);

    const argv = fake.calls()[0]!.args;
    expect(argv[0]).toBe("exec");
    expect(argv).toContain("--json");
    expect(argv).toContain("--output-schema");
    expect(argv).toContain("--skip-git-repo-check");
    // YOLO: bypass the sandbox so headless agents get network/web access.
    expect(argv).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(argv).not.toContain("--full-auto");
  });

  it("returns AdapterSpawn on non-zero exit", async () => {
    const adapter = createCodexAdapter({
      processRunner: createFakeProcessRunner({ codex: { stdout: "", stderr: "bad", code: 2 } }),
      fileStore: stubFileStore(),
    });
    const res = await adapter.run({ prompt: "x", cwd: "/tmp", signal: new AbortController().signal }, { runId: "r" as RunId, seq: 0 });
    expect(res._unsafeUnwrapErr().kind).toBe("AdapterSpawn");
  });

  it("returns SchemaValidation when the parsed output doesn't match the schema", async () => {
    // Valid JSON, wrong shape (n is a string). codex validates at the adapter boundary now,
    // so this surfaces as a SchemaValidation rather than passing through as valid data.
    const mismatched = [
      `{"type":"turn.started"}`,
      `{"type":"item.completed","item":{"type":"agent_message","text":"{\\"n\\": \\"oops\\"}"}}`,
      `{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}`,
    ].join("\n");
    const adapter = createCodexAdapter({
      processRunner: createFakeProcessRunner({ codex: { stdout: mismatched, code: 0 } }),
      fileStore: stubFileStore(),
    });
    const res = await adapter.run(
      { prompt: "give n", schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false }, cwd: "/tmp", signal: new AbortController().signal },
      { runId: "r" as RunId, seq: 0 },
    );
    expect(res.isErr()).toBe(true);
    expect(res._unsafeUnwrapErr().kind).toBe("SchemaValidation");
  });

  it("returns trimmed prose with no `data` when called without a schema", async () => {
    const prose = [
      `{"type":"turn.started"}`,
      `{"type":"item.completed","item":{"type":"agent_message","text":"  hello world  "}}`,
      `{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":11}}`,
    ].join("\n");
    const adapter = createCodexAdapter({
      processRunner: createFakeProcessRunner({ codex: { stdout: prose, code: 0 } }),
      fileStore: stubFileStore(),
    });

    const res = await adapter.run(
      { prompt: "say hi", cwd: "/tmp", signal: new AbortController().signal },
      { runId: "r" as RunId, seq: 0 },
    );

    const r = res._unsafeUnwrap();
    expect(r.text).toBe("hello world");
    expect(r.data).toBeUndefined();
  });

  it("returns AdapterSpawn (not SchemaValidation) when the final message is not valid JSON but a schema was requested", async () => {
    const prose = [
      `{"type":"turn.started"}`,
      `{"type":"item.completed","item":{"type":"agent_message","text":"sorry, I cannot comply"}}`,
      `{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}`,
    ].join("\n");
    const adapter = createCodexAdapter({
      processRunner: createFakeProcessRunner({ codex: { stdout: prose, code: 0 } }),
      fileStore: stubFileStore(),
    });

    const res = await adapter.run(
      { prompt: "give n", schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false }, cwd: "/tmp", signal: new AbortController().signal },
      { runId: "r" as RunId, seq: 0 },
    );

    const e = res._unsafeUnwrapErr();
    expect(e.kind).toBe("AdapterSpawn");
    expect(e.kind === "AdapterSpawn" && e.cause).toMatch(/not valid JSON for the schema/);
  });

  it("estimates output tokens (approximate) when codex reports no usage", async () => {
    // No turn.completed usage -> adapter must fall back to a length estimate so budget gets a number.
    const message = "1234567890"; // 10 chars -> ceil(10/4) = 3
    const noUsage = [
      `{"type":"turn.started"}`,
      `{"type":"item.completed","item":{"type":"agent_message","text":"${message}"}}`,
      `{"type":"turn.completed"}`,
    ].join("\n");
    const adapter = createCodexAdapter({
      processRunner: createFakeProcessRunner({ codex: { stdout: noUsage, code: 0 } }),
      fileStore: stubFileStore(),
    });

    const res = await adapter.run(
      { prompt: "x", cwd: "/tmp", signal: new AbortController().signal },
      { runId: "r" as RunId, seq: 0 },
    );

    const r = res._unsafeUnwrap();
    expect(r.usage.approximate).toBe(true);
    expect(r.usage.outputTokens).toBe(Math.ceil(message.length / 4));
  });
});
