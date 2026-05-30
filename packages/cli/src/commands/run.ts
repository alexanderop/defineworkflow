import type { AdapterId } from "@workflow/adapters";
import { createMockRunner } from "@workflow/core";
import type { AppDeps } from "../app.js";
import { loadMeta } from "../loader.js";
import { decideConsent, promptConsent } from "../consent.js";
import { resolveHarness, buildRunner } from "../adapter-select.js";
import { genRunId } from "../run-id.js";
import type { RunMeta } from "../registry.js";
import { runForeground } from "../execute.js";
import { formatError } from "../format-error.js";

export interface RunArgs {
  readonly script: string;
  readonly argsJson?: string | undefined;
  readonly detach: boolean;
  readonly yes: boolean;
  /** Run against a fabricating mock runner: no real agents, no tokens — a token-free dev loop. */
  readonly mock?: boolean;
}

export async function runCommand(args: RunArgs, deps: AppDeps): Promise<number> {
  const source = deps.readTextFile(args.script);
  if (source === undefined) {
    deps.print(`error: cannot read script ${args.script}\n`);
    return 1;
  }

  let parsedArgs: unknown = null;
  if (args.argsJson !== undefined) {
    try {
      parsedArgs = JSON.parse(args.argsJson);
    } catch {
      deps.print("error: --args is not valid JSON\n");
      return 1;
    }
  }

  let meta;
  try {
    meta = loadMeta(source);
  } catch (e) {
    deps.print(`error: ${(e as Error).message}\n`);
    return 1;
  }

  if (deps.config.disableWorkflows) {
    deps.print("error: workflows are disabled (WORKFLOW_DISABLE / config.disableWorkflows)\n");
    return 1;
  }

  // A --mock run spawns no real agents and spends no tokens, so there is nothing to consent to.
  if (!args.mock) {
    const decision = decideConsent({
      config: deps.config,
      project: deps.cwd,
      name: meta.name,
      yes: args.yes,
      isTTY: deps.isTTY,
      ci: deps.ci,
    });
    if (decision === "prompt") {
      const consent = await promptConsent(meta, source, deps.consentIO);
      if (!consent.allow) {
        deps.print("aborted\n");
        return 1;
      }
      if (consent.remember) deps.persistConsent(deps.cwd, meta.name);
    }
  }

  // The declared harness is still validated (catches typos), but in --mock mode it need not
  // be installed: we use a fabricating runner instead of building the real adapter.
  const harnessResult = resolveHarness(meta.harness);
  if (harnessResult.isErr()) {
    deps.print(`error: ${formatError(harnessResult.error)}\n`);
    return 1;
  }
  const adapter: AdapterId = harnessResult.value;

  let runner;
  if (args.mock) {
    runner = createMockRunner({ delayMs: deps.isTTY ? 120 : 0 });
  } else {
    const runnerResult = buildRunner(adapter, deps.config, { processRunner: deps.processRunner, complete: deps.complete });
    if (runnerResult.isErr()) {
      deps.print(`error: ${formatError(runnerResult.error)}\n`);
      return 1;
    }
    runner = runnerResult.value;
  }

  const runId = genRunId(meta.name, { now: deps.now, rand: deps.rand });
  const meta0: RunMeta = {
    runId,
    name: meta.name,
    scriptPath: args.script,
    args: parsedArgs,
    adapter,
    status: "running",
    startedAt: deps.now(),
    endedAt: null,
    pid: args.detach ? null : deps.pid(),
    scriptHash: deps.hash(source),
  };
  deps.registry.init(meta0, source);

  // --mock is an interactive dev loop; it always runs in the foreground (detach is ignored).
  if (args.detach && !args.mock) {
    const pid = deps.spawnDetached(runId);
    deps.registry.updateMeta(runId, { pid });
    deps.print(`${runId}\nwatch with: workflow watch ${runId}\n`);
    return 0;
  }

  if (args.mock) deps.print(`running '${meta.name}' in --mock mode — no real agents, no tokens spent\n`);
  return runForeground(deps, {
    runId,
    source,
    args: parsedArgs,
    runner,
    adapter: args.mock ? "mock" : adapter,
    seed: [],
    ...(args.mock ? { mock: true } : {}),
  });
}
