import { describe, it, expect } from "vitest";
import { createFakeProcessRunner } from "./fake-process-runner.js";

describe("FakeProcessRunner", () => {
  it("returns canned stdout/exit matched by command, and records the call", async () => {
    const fake = createFakeProcessRunner({
      claude: { stdout: '{"ok":true}', code: 0 },
    });
    const ctrl = new AbortController();
    const out = await fake.run({
      command: "claude",
      args: ["-p", "hi"],
      cwd: "/tmp",
      signal: ctrl.signal,
    });
    expect(out.code).toBe(0);
    expect(out.stdout).toBe('{"ok":true}');
    expect(fake.calls()[0]?.args).toEqual(["-p", "hi"]);
  });

  it("supports a per-command handler that can read stdin", async () => {
    const fake = createFakeProcessRunner({
      cat: (spec) => ({ stdout: spec.stdin ?? "", code: 0 }),
    });
    const out = await fake.run({
      command: "cat",
      args: [],
      cwd: "/tmp",
      signal: new AbortController().signal,
      stdin: "piped",
    });
    expect(out.stdout).toBe("piped");
  });
});
