import { describe, it, expect } from "vitest";
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
      { runId: "r", seq: 0, onProgress: (p) => progress.push(p) },
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
    const res = await adapter.run({ prompt: "x", cwd: "/tmp", signal: new AbortController().signal }, { runId: "r", seq: 0 });
    expect(res._unsafeUnwrapErr().kind).toBe("AdapterSpawn");
  });
});
