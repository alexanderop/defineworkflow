import vm from "node:vm";
import { transformSync } from "esbuild";

export interface SandboxResult {
  readonly meta: { readonly name: string; readonly description: string; readonly phases?: readonly unknown[] };
  readonly returnValue: unknown;
}

/**
 * Transform a workflow script into a runnable async IIFE.
 * - `export const meta = …` becomes a plain `const meta = …`, captured after assignment
 * - the trailing top-level `return` is valid because the body runs inside an async arrow
 * - TS is stripped by esbuild
 */
export function transformScript(source: string): string {
  if (!/export\s+const\s+meta\s*=/.test(source)) {
    throw new Error("SandboxViolation: workflow script must export `const meta`");
  }
  // Declare `const meta` (so the script body can reference it) AND mirror the same
  // value onto a global for extraction — without needing to locate the end of the
  // meta literal. Robust to multi-line literals, `as const`, semicolons inside
  // strings, and a missing trailing semicolon.
  const safe = source.replace(/export\s+const\s+meta\s*=\s*/, "const meta = globalThis.__meta = ");
  const wrapped = `(async () => {\n${safe}\n})()`;
  return transformSync(wrapped, { loader: "ts", format: "esm" }).code;
}

function makeBannedDate(): typeof Date {
  const RealDate = Date;
  const Banned = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) {
      throw new Error("SandboxViolation: argless new Date() is not allowed in a workflow");
    }
    // @ts-expect-error forwarding constructor args
    return new RealDate(...args);
  } as unknown as typeof Date;
  Banned.now = () => {
    throw new Error("SandboxViolation: Date.now() is not allowed in a workflow");
  };
  Banned.parse = RealDate.parse;
  Banned.UTC = RealDate.UTC;
  return Banned;
}

const bannedMath = {
  ...Math,
  random: () => {
    throw new Error("SandboxViolation: Math.random() is not allowed in a workflow");
  },
};

/**
 * Read the script's `meta` without running its body to completion.
 * `meta` is assigned synchronously at the top of the transformed script, so injecting
 * sentinel-throwing primitives aborts execution at the first `agent()`/`parallel()`/…
 * call while `__meta` is already captured. Used by the CLI consent flow, which must show
 * `meta.name` + phases before deciding to run.
 */
export function extractMeta(source: string): SandboxResult["meta"] {
  const js = transformScript(source);
  const sentinel = Symbol("meta-probe");
  const stop = (): never => {
    throw sentinel;
  };
  const sandbox: Record<string, unknown> = {
    agent: stop,
    parallel: stop,
    pipeline: stop,
    workflow: stop,
    phase: () => {},
    log: () => {},
    args: {},
    budget: { total: null, spent: () => 0, remaining: () => Infinity, record: () => {} },
    Math: bannedMath,
    Date: makeBannedDate(),
    __meta: undefined,
    Promise,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    console,
  };
  const context = vm.createContext(sandbox);
  // The body runs inside an async IIFE, so a sentinel thrown at the first primitive call
  // surfaces as a rejected promise rather than a sync throw. `meta` is already assigned
  // synchronously by then; swallow both the sync and async rejection paths.
  try {
    const ran = new vm.Script(js, { filename: "workflow-meta.js" }).runInContext(context) as unknown;
    if (ran && typeof (ran as PromiseLike<unknown>).then === "function") {
      (ran as PromiseLike<unknown>).then(undefined, () => {});
    }
  } catch {
    // Sync throw before the body returned a promise — meta is still captured below.
  }
  const meta = sandbox.__meta as SandboxResult["meta"] | undefined;
  if (!meta) {
    throw new Error("SandboxViolation: workflow script must export `const meta`");
  }
  return meta;
}

export async function runInSandbox(
  source: string,
  globals: Record<string, unknown>,
): Promise<SandboxResult> {
  const js = transformScript(source);

  const sandbox: Record<string, unknown> = {
    ...globals,
    Math: bannedMath,
    Date: makeBannedDate(),
    __meta: undefined,
    Promise,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    console,
  };

  const context = vm.createContext(sandbox);
  const script = new vm.Script(js, { filename: "workflow.js" });
  const returnValue = await script.runInContext(context);

  const meta = sandbox.__meta as SandboxResult["meta"] | undefined;
  if (!meta) {
    throw new Error("SandboxViolation: workflow script must export `const meta`");
  }
  return { meta, returnValue };
}
