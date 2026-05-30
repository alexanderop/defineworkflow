import type { ProcessRunner, ProcessSpec, ProcessOutput } from "./process-runner.js";

export type FakeResponse =
  | { readonly stdout?: string; readonly stderr?: string; readonly code?: number }
  | ((spec: ProcessSpec) => { stdout?: string; stderr?: string; code?: number });

export interface FakeProcessRunner extends ProcessRunner {
  calls(): readonly ProcessSpec[];
}

/** Test double: matches a response by `spec.command`. */
export function createFakeProcessRunner(
  responses: Readonly<Record<string, FakeResponse>>,
): FakeProcessRunner {
  const recorded: ProcessSpec[] = [];
  return {
    run: async (spec): Promise<ProcessOutput> => {
      recorded.push(spec);
      const r = responses[spec.command];
      const resolved = typeof r === "function" ? r(spec) : (r ?? {});
      const stdout = resolved.stdout ?? "";
      // Drive streaming adapters: replay stdout line-by-line through onLine, matching
      // the real runner's newline-delimited semantics (trailing newline => no empty line).
      if (spec.onLine && stdout.length > 0) {
        const lines = stdout.split("\n");
        if (lines[lines.length - 1] === "") lines.pop();
        for (const line of lines) spec.onLine(line);
      }
      return { code: resolved.code ?? 0, stdout, stderr: resolved.stderr ?? "" };
    },
    calls: () => recorded,
  };
}
