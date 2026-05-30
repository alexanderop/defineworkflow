import { z } from "zod";
import { extractMeta, runInSandbox, type LoadedWorkflow, type Runtime, type SandboxResult } from "@workflow/core";

/** Read a workflow's `meta` without executing its body (used by the consent flow). */
export function loadMeta(source: string): SandboxResult["meta"] {
  return extractMeta(source);
}

/**
 * Wrap a workflow script string as a `LoadedWorkflow`. `run` injects the runtime's
 * primitives as the sandbox globals and returns the script's top-level return value.
 */
export function loadWorkflow(source: string): LoadedWorkflow {
  const meta = extractMeta(source);
  return {
    meta,
    run: async (runtime: Runtime, runArgs?: unknown): Promise<unknown> => {
      const globals: Record<string, unknown> = {
        defineWorkflow: (definition: unknown) => definition,
        // The engine's zod instance, injected so `import { z } from "defineworkflow"` (stripped
        // by the sandbox) resolves to a real `z` for `agent({ schema: z.object(...) })`.
        z,
        agent: runtime.agent,
        parallel: runtime.parallel,
        pipeline: runtime.pipeline,
        workflow: runtime.workflow,
        phase: runtime.phase,
        log: runtime.log,
        args: runArgs ?? runtime.args,
        budget: runtime.budget,
      };
      const { returnValue } = await runInSandbox(source, globals);
      return returnValue;
    },
  };
}
