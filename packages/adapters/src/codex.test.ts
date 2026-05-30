import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createCodexAdapter } from "./codex.js";
import { createFakeProcessRunner } from "./fake-process-runner.js";

const fixture = readFileSync(new URL("../fixtures/codex-result.txt", import.meta.url), "utf8");

describe("codex adapter", () => {
  it("writes a schema file, passes -o, parses the final-message file, and builds expected argv", async () => {
    const files = new Map<string, string>();
    const fake = createFakeProcessRunner({
      codex: (spec) => {
        const oIndex = spec.args.indexOf("-o");
        const outPath = spec.args[oIndex + 1]!;
        files.set(outPath, fixture);
        return { stdout: "", code: 0 };
      },
    });
    const adapter = createCodexAdapter({
      processRunner: fake,
      fileStore: {
        writeTemp: async (name, content) => { const p = `/tmp/${name}`; files.set(p, content); return p; },
        read: async (p) => files.get(p) ?? "",
        cleanup: async () => {},
      },
    });
    expect(adapter.id).toBe("codex");

    const res = await adapter.run(
      { prompt: "give n", schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false }, cwd: "/tmp", label: "a", signal: new AbortController().signal },
      { runId: "r", seq: 0 },
    );
    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap().data).toEqual({ n: 7 });

    const argv = fake.calls()[0]!.args;
    expect(argv[0]).toBe("exec");
    expect(argv).toContain("--output-schema");
    expect(argv).toContain("-o");
    expect(argv).toContain("--skip-git-repo-check");
    // YOLO: bypass the sandbox so headless agents get network/web access.
    expect(argv).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(argv).not.toContain("--full-auto");
  });

  it("returns AdapterSpawn on non-zero exit", async () => {
    const adapter = createCodexAdapter({
      processRunner: createFakeProcessRunner({ codex: { stdout: "", stderr: "bad", code: 2 } }),
      fileStore: { writeTemp: async () => "/tmp/s", read: async () => "", cleanup: async () => {} },
    });
    const res = await adapter.run({ prompt: "x", cwd: "/tmp", signal: new AbortController().signal }, { runId: "r", seq: 0 });
    expect(res._unsafeUnwrapErr().kind).toBe("AdapterSpawn");
  });
});
