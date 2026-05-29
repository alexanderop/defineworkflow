import { describe, it, expect } from "vitest";
import { createProcessRunner } from "./process-runner.js";

describe("createProcessRunner", () => {
  it("captures stdout and exit code from a real process", async () => {
    const runner = createProcessRunner();
    const out = await runner.run({
      command: process.execPath,
      args: ["-e", "process.stdout.write('hello'); process.exit(0)"],
      cwd: process.cwd(),
      signal: new AbortController().signal,
    });
    expect(out.code).toBe(0);
    expect(out.stdout).toBe("hello");
  });

  it("forwards stdin", async () => {
    const runner = createProcessRunner();
    const out = await runner.run({
      command: process.execPath,
      args: ["-e", "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d.toUpperCase()))"],
      cwd: process.cwd(),
      signal: new AbortController().signal,
      stdin: "abc",
    });
    expect(out.stdout).toBe("ABC");
  });
});
