import { spawn } from "node:child_process";

export interface ProcessSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly stdin?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface ProcessOutput {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessRunner {
  run(spec: ProcessSpec): Promise<ProcessOutput>;
}

/** Default runner: spawns a real child process, buffers stdout/stderr, resolves on close. */
export function createProcessRunner(): ProcessRunner {
  return {
    run: (spec) =>
      new Promise<ProcessOutput>((resolve, reject) => {
        const child = spawn(spec.command, [...spec.args], {
          cwd: spec.cwd,
          signal: spec.signal,
          env: spec.env ? { ...process.env, ...spec.env } : process.env,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => {
          stdout += d.toString("utf8");
        });
        child.stderr.on("data", (d: Buffer) => {
          stderr += d.toString("utf8");
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
        // Always end stdin: write the payload when provided, otherwise send a bare
        // EOF. Leaving the pipe open hangs children that read stdin in a tool loop —
        // e.g. `claude -p` web-search agents block forever waiting on input.
        child.stdin.end(spec.stdin ?? undefined);
      }),
  };
}
