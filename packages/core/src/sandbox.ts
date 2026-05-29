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
  // Rename `export const meta = …` to a plain `const meta = …` and inject a
  // capture call IMMEDIATELY AFTER the meta declaration's terminating
  // semicolon. We cannot append the capture to the end of the body because the
  // workflow source ends with a top-level `return`, which makes any trailing
  // statement unreachable dead code (esbuild keeps it but it never runs).
  const metaDecl = /export\s+const\s+meta\s*=\s*([^;]+);/;
  const match = metaDecl.exec(source);
  if (!match) {
    throw new Error("SandboxViolation: workflow script must export `const meta`");
  }
  const safe = source.replace(
    metaDecl,
    `const meta = ${match[1]};\nglobalThis.__captureMeta(meta);`,
  );
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

export async function runInSandbox(
  source: string,
  globals: Record<string, unknown>,
): Promise<SandboxResult> {
  const js = transformScript(source);
  let metaCaptured: SandboxResult["meta"] | undefined;

  const bannedMath = {
    ...Math,
    random: () => {
      throw new Error("SandboxViolation: Math.random() is not allowed in a workflow");
    },
  };

  const context = vm.createContext({
    ...globals,
    Math: bannedMath,
    Date: makeBannedDate(),
    __captureMeta: (m: SandboxResult["meta"]) => {
      metaCaptured = m;
    },
    Promise,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    console,
  });

  const script = new vm.Script(js, { filename: "workflow.js" });
  const returnValue = await script.runInContext(context);

  if (!metaCaptured) {
    throw new Error("SandboxViolation: workflow script must export `const meta`");
  }
  return { meta: metaCaptured, returnValue };
}
