import vm from "node:vm";
import { transformSync } from "esbuild";
import { parse } from "acorn";
import type { HarnessId, WorkflowMeta } from "./types.js";

export interface SandboxResult {
  readonly meta: WorkflowMeta;
  readonly returnValue: unknown;
}

// Loose AST node shape — acorn types are nominal, but we only ever read a handful of fields.
type AstNode = { type: string; [key: string]: unknown };

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
 * Read and validate the script's `meta` **statically**, without executing any of its body.
 *
 * `transformScript` already strips TS and rewrites `export const meta = <LIT>` to
 * `const meta = globalThis.__meta = <LIT>`, so the output is plain JS that acorn can parse.
 * We then assert that the first statement of the workflow body is that `const meta`
 * declaration and that its value is a **pure literal** — no function calls, spreads,
 * computed keys, or template interpolation. This enforces the "meta must be a pure literal"
 * contract that the runtime previously only documented (the old probe just *ran* the body
 * with sentinel stubs, so `export const meta = build()` would silently execute `build()`).
 *
 * Used by the CLI consent flow, which must show `meta.name` + phases before deciding to run.
 */
export function extractMeta(source: string): WorkflowMeta {
  const js = transformScript(source);
  const program = parse(js, { ecmaVersion: "latest", sourceType: "script" }) as unknown as AstNode;
  const literal = locateMetaLiteral(program);
  const meta = evaluateLiteral(literal, "meta");
  return validateMeta(meta);
}

/**
 * Walk the transformed program to the first statement of the workflow body and return the
 * literal AST node assigned to `meta`. Throws SandboxViolation if `meta` isn't the first
 * statement. Shape produced by `transformScript`:
 *   ExpressionStatement → CallExpression( ArrowFunctionExpression ).body(BlockStatement)
 *   first statement: VariableDeclaration `const meta = globalThis.__meta = <LIT>`
 */
function locateMetaLiteral(program: AstNode): AstNode {
  const top = (program.body as AstNode[] | undefined)?.[0];
  const call = top?.type === "ExpressionStatement" ? (top.expression as AstNode) : undefined;
  const arrow = call?.type === "CallExpression" ? (call.callee as AstNode) : undefined;
  const block = arrow?.type === "ArrowFunctionExpression" ? (arrow.body as AstNode) : undefined;
  const stmts = (block?.body as AstNode[] | undefined) ?? [];

  // Skip a leading "use strict" directive esbuild may emit.
  const first = stmts.find(
    (s) => !(s.type === "ExpressionStatement" && (s.expression as AstNode)?.type === "Literal"),
  );
  if (first?.type !== "VariableDeclaration" || (first as AstNode).kind !== "const") {
    throw new Error("SandboxViolation: `export const meta = { … }` must be the first statement in the workflow");
  }
  const decl = (first.declarations as AstNode[])[0];
  const id = decl?.id as AstNode | undefined;
  if (!decl || id?.type !== "Identifier" || id.name !== "meta") {
    throw new Error("SandboxViolation: the first statement must declare `meta`");
  }
  // Unwrap the `globalThis.__meta = <LIT>` assignment the transform injects.
  let init = decl.init as AstNode | undefined;
  while (init?.type === "AssignmentExpression") init = init.right as AstNode;
  if (!init) throw new Error("SandboxViolation: `meta` must have a literal value");
  return init;
}

/** Evaluate a JSON-ish literal AST node, rejecting anything non-literal. Mirrors the contract:
 *  no spreads, computed keys, methods, function calls, or template interpolation. */
function evaluateLiteral(node: AstNode, path: string): unknown {
  switch (node.type) {
    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      for (const prop of node.properties as AstNode[]) {
        if (prop.type === "SpreadElement") throw violation(`spread not allowed in ${path}`);
        if (prop.type !== "Property") throw violation(`only plain properties allowed in ${path}`);
        if (prop.computed) throw violation(`computed keys not allowed in ${path}`);
        if (prop.kind !== "init" || prop.method) throw violation(`methods/accessors not allowed in ${path}`);
        const key = propertyKey(prop.key as AstNode, path);
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          throw violation(`reserved key name not allowed in ${path}: ${key}`);
        }
        out[key] = evaluateLiteral(prop.value as AstNode, `${path}.${key}`);
      }
      return out;
    }
    case "ArrayExpression":
      return (node.elements as Array<AstNode | null>).map((el, i) => {
        if (!el) throw violation(`sparse arrays not allowed in ${path}`);
        if (el.type === "SpreadElement") throw violation(`spread not allowed in ${path}`);
        return evaluateLiteral(el, `${path}[${i}]`);
      });
    case "Literal":
      return node.value;
    case "TemplateLiteral":
      if ((node.expressions as unknown[]).length > 0) throw violation(`template interpolation not allowed in ${path}`);
      return (node.quasis as AstNode[])
        .map((q) => (q.value as { cooked?: string; raw: string }).cooked ?? (q.value as { raw: string }).raw)
        .join("");
    case "UnaryExpression": {
      const arg = node.argument as AstNode;
      if (node.operator === "-" && arg.type === "Literal" && typeof arg.value === "number") return -arg.value;
      throw violation(`only negative-number unary allowed in ${path}`);
    }
    default:
      throw violation(`non-literal value in ${path}: ${node.type}`);
  }
}

function propertyKey(node: AstNode, path: string): string {
  if (node.type === "Identifier") return node.name as string;
  if (node.type === "Literal" && (typeof node.value === "string" || typeof node.value === "number")) {
    return String(node.value);
  }
  throw violation(`unsupported key in ${path}: ${node.type}`);
}

function validateMeta(meta: unknown): WorkflowMeta {
  if (!meta || typeof meta !== "object") throw violation("meta must be an object");
  const m = meta as Record<string, unknown>;
  if (typeof m.name !== "string" || !m.name.trim()) throw violation("meta.name must be a non-empty string");
  if (typeof m.description !== "string" || !m.description.trim()) {
    throw violation("meta.description must be a non-empty string");
  }
  // Harness is NOT validated here: the sandbox only enforces determinism. The
  // declared `meta.harness` is the single source of truth, but validating it
  // (→ `HarnessNotDeclared`) is the CLI layer's job (`resolveHarness`), so a
  // missing/unknown value is passed through untouched for that gate to report.
  if (m.phases !== undefined && !Array.isArray(m.phases)) throw violation("meta.phases must be an array");
  return {
    name: m.name,
    description: m.description,
    harness: m.harness as HarnessId,
    ...(m.phases !== undefined ? { phases: m.phases as readonly unknown[] } : {}),
  };
}

function violation(message: string): Error {
  return new Error(`SandboxViolation: ${message}`);
}

export async function runInSandbox(
  source: string,
  globals: Record<string, unknown>,
): Promise<SandboxResult> {
  // Validate meta statically *before* running the body — a non-literal meta is a contract
  // violation, not something we want to discover by executing arbitrary code.
  const meta = extractMeta(source);
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

  return { meta, returnValue };
}
