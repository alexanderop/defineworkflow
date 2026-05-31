import type { Immutable } from "@workflow/core";
import type { ProcessRunner, ProcessSpec, ProcessOutput } from "./process-runner.js";

interface ProcessResponseShape {
  stdout?: string;
  stderr?: string;
  code?: number;
}

/** Both arms share one deeply-readonly shape, so the object and function forms can't disagree on
 * mutability (the old union hand-`readonly`'d one arm and left the function arm fully mutable). */
export type FakeResponse =
  | Immutable<ProcessResponseShape>
  | ((spec: ProcessSpec) => Immutable<ProcessResponseShape>);

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
