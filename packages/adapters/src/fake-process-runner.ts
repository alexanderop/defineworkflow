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
      return { code: resolved.code ?? 0, stdout: resolved.stdout ?? "", stderr: resolved.stderr ?? "" };
    },
    calls: () => recorded,
  };
}
