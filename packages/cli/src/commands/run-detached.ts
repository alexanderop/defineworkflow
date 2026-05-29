import type { AppDeps } from "../app.js";
import { buildRunner } from "../adapter-select.js";
import { runHeadless } from "../execute.js";

/** Hidden `__run-detached <runId>` body: executed by the forked child to run a backgrounded workflow. */
export async function runDetachedCommand(runId: string, deps: AppDeps): Promise<number> {
  const meta = deps.registry.readMeta(runId);
  if (!meta) return 1;
  const source = deps.registry.readScript(runId);
  if (source === undefined) return 1;

  const runnerResult = buildRunner(meta.adapter, deps.config, { processRunner: deps.processRunner, complete: deps.complete });
  if (runnerResult.isErr()) {
    deps.registry.updateMeta(runId, { status: "failed", endedAt: deps.now() });
    return 1;
  }

  deps.registry.updateMeta(runId, { pid: deps.pid() });
  const controller = new AbortController();
  deps.onSigterm(() => controller.abort());

  return runHeadless(deps, { runId, source, args: meta.args, runner: runnerResult.value, adapter: meta.adapter, seed: [] }, controller);
}
