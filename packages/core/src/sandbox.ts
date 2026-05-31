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
type LocatedMeta = { readonly node: AstNode; readonly mode: "meta" | "defineWorkflow" };

/** Narrow an unknown AST value to a node — an object carrying a string `type`. */
function asNode(value: unknown): AstNode | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate: { type?: unknown } = value;
  if (typeof candidate.type !== "string") return undefined;
  const node: AstNode = { ...candidate, type: candidate.type };
  return node;
}

/** Narrow an unknown AST value to an array of nodes; non-array → empty. Holes survive as undefined. */
function asNodeArray(value: unknown): Array<AstNode | undefined> {
  return Array.isArray(value) ? value.map(asNode) : [];
}

/** Read a child node off `node[key]`, narrowing it the same way as {@link asNode}. */
function childNode(node: AstNode, key: string): AstNode | undefined {
  return asNode(node[key]);
}

/**
 * Transform a workflow script into a runnable async IIFE.
 * - `export const meta = …` becomes a plain `const meta = …`, captured after assignment
 * - `export default value` becomes `return value` for typecheck-friendly workflow results
 * - a trailing top-level `return` is still valid because the body runs inside an async arrow
 * - TS is stripped by esbuild
 */
export function transformScript(source: string): string {
  const authoringSource = stripWorkflowImports(source);
  if (!/export\s+const\s+meta\s*=/.test(authoringSource) && !/export\s+default\s+defineWorkflow\s*\(/.test(authoringSource)) {
    throw new Error("SandboxViolation: workflow script must export `const meta` or `export default defineWorkflow({ … })`");
  }
  if (/export\s+default\s+defineWorkflow\s*\(/.test(authoringSource)) {
    const safe = authoringSource.replace(
      /\bexport\s+default\s+defineWorkflow\s*\(/,
      "const __workflow = globalThis.__workflow = defineWorkflow(",
    );
    const wrapped = `(async () => {\n${safe}\nreturn await __workflow.run({ agent, parallel, pipeline, workflow, phase, log, askUserQuestion, args, budget });\n})()`;
    return transformSync(wrapped, { loader: "ts", format: "esm" }).code;
  }
  // Declare `const meta` (so the script body can reference it) AND mirror the same
  // value onto a global for extraction — without needing to locate the end of the
  // meta literal. Robust to multi-line literals, `as const`, semicolons inside
  // strings, and a missing trailing semicolon.
  const safe = authoringSource
    .replace(/export\s+const\s+meta\s*=\s*/, "const meta = globalThis.__meta = ")
    .replace(/\bexport\s+default\b/, "return");
  const wrapped = `(async () => {\n${safe}\n})()`;
  return transformSync(wrapped, { loader: "ts", format: "esm" }).code;
}

function stripWorkflowImports(source: string): string {
  // Strip the authoring import — both the published package name
  // (`defineworkflow`) and the legacy `workflow` specifier — since the runtime
  // injects these primitives into the sandbox instead.
  return source.replace(
    /^\s*import\s+(?:type\s+)?(?:(?!^\s*import\s)[\s\S])*?\s+from\s+["'](?:defineworkflow|workflow)["'];?\s*$/gm,
    "",
  );
}

function makeBannedDate(): typeof Date {
  const RealDate = Date;
  const Banned = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) {
      throw new Error("SandboxViolation: argless new Date() is not allowed in a workflow");
    }
    // @ts-expect-error forwarding constructor args
    return new RealDate(...args);
  };
  Banned.now = () => {
    throw new Error("SandboxViolation: Date.now() is not allowed in a workflow");
  };
  Banned.parse = RealDate.parse;
  Banned.UTC = RealDate.UTC;
  // oxlint-disable-next-line typescript/consistent-type-assertions -- a hand-rolled Date stand-in for the sandbox cannot be expressed as `typeof Date` without a cast
  const banned = Banned as unknown as typeof Date;
  return banned;
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
  const program = asNode(parse(js, { ecmaVersion: "latest", sourceType: "script" }));
  if (!program) throw violation("workflow script did not parse to a program node");
  const located = locateMetaLiteral(program);
  const meta =
    located.mode === "defineWorkflow"
      ? evaluateWorkflowDefinitionLiteral(located.node)
      : evaluateLiteral(located.node, "meta");
  return validateMeta(meta);
}

/**
 * Walk the transformed program to the first statement of the workflow body and return the
 * literal AST node assigned to `meta`. Throws SandboxViolation if `meta` isn't the first
 * statement. Shape produced by `transformScript`:
 *   ExpressionStatement → CallExpression( ArrowFunctionExpression ).body(BlockStatement)
 *   first statement: VariableDeclaration `const meta = globalThis.__meta = <LIT>`
 */
function locateMetaLiteral(program: AstNode): LocatedMeta {
  const top = asNodeArray(program.body)[0];
  const call = top?.type === "ExpressionStatement" ? childNode(top, "expression") : undefined;
  const arrow = call?.type === "CallExpression" ? childNode(call, "callee") : undefined;
  const block = arrow?.type === "ArrowFunctionExpression" ? childNode(arrow, "body") : undefined;
  const stmts = block ? asNodeArray(block.body) : [];

  // Skip a leading "use strict" directive esbuild may emit.
  const first = stmts.find(
    (s) => !(s?.type === "ExpressionStatement" && childNode(s, "expression")?.type === "Literal"),
  );
  if (first?.type !== "VariableDeclaration" || first.kind !== "const") {
    throw new Error("SandboxViolation: workflow metadata must be the first statement in the workflow");
  }
  const decl = asNodeArray(first.declarations)[0];
  const id = decl ? childNode(decl, "id") : undefined;
  if (!decl || id?.type !== "Identifier") throw new Error("SandboxViolation: the first statement must declare workflow metadata");
  // Unwrap the `globalThis.__meta = <LIT>` assignment the transform injects.
  let init = childNode(decl, "init");
  while (init?.type === "AssignmentExpression") init = childNode(init, "right");
  if (!init) throw new Error("SandboxViolation: `meta` must have a literal value");
  if (id.name === "meta") return { node: init, mode: "meta" };
  if (id.name === "__workflow") {
    if (init.type !== "CallExpression") throw violation("defineWorkflow metadata must be a call");
    const callee = childNode(init, "callee");
    if (callee?.type !== "Identifier" || callee.name !== "defineWorkflow") {
      throw violation("default workflow export must call defineWorkflow");
    }
    const firstArg = asNodeArray(init.arguments)[0];
    if (!firstArg) throw violation("defineWorkflow requires a metadata object");
    return { node: firstArg, mode: "defineWorkflow" };
  }
  throw new Error("SandboxViolation: the first statement must declare `meta` or `defineWorkflow`");
}

function evaluateWorkflowDefinitionLiteral(node: AstNode): unknown {
  if (node.type !== "ObjectExpression") throw violation("defineWorkflow argument must be an object literal");
  const out: Record<string, unknown> = {};
  for (const prop of asNodeArray(node.properties)) {
    if (!prop) throw violation("only plain properties allowed in defineWorkflow metadata");
    if (prop.type === "SpreadElement") throw violation("spread not allowed in defineWorkflow metadata");
    if (prop.type !== "Property") throw violation("only plain properties allowed in defineWorkflow metadata");
    if (prop.computed) throw violation("computed keys not allowed in defineWorkflow metadata");
    const keyNode = childNode(prop, "key");
    if (!keyNode) throw violation("only plain properties allowed in defineWorkflow metadata");
    const key = propertyKey(keyNode, "defineWorkflow");
    if (key === "run") continue;
    if (prop.kind !== "init" || prop.method) throw violation(`methods/accessors not allowed in defineWorkflow.${key}`);
    const valueNode = childNode(prop, "value");
    if (!valueNode) throw violation(`non-literal value in defineWorkflow.${key}`);
    out[key] = evaluateLiteral(valueNode, `defineWorkflow.${key}`);
  }
  return out;
}

/** Evaluate a JSON-ish literal AST node, rejecting anything non-literal. Mirrors the contract:
 *  no spreads, computed keys, methods, function calls, or template interpolation. */
function evaluateLiteral(node: AstNode, path: string): unknown {
  switch (node.type) {
    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      for (const prop of asNodeArray(node.properties)) {
        if (!prop) throw violation(`only plain properties allowed in ${path}`);
        if (prop.type === "SpreadElement") throw violation(`spread not allowed in ${path}`);
        if (prop.type !== "Property") throw violation(`only plain properties allowed in ${path}`);
        if (prop.computed) throw violation(`computed keys not allowed in ${path}`);
        if (prop.kind !== "init" || prop.method) throw violation(`methods/accessors not allowed in ${path}`);
        const keyNode = childNode(prop, "key");
        if (!keyNode) throw violation(`only plain properties allowed in ${path}`);
        const key = propertyKey(keyNode, path);
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          throw violation(`reserved key name not allowed in ${path}: ${key}`);
        }
        const valueNode = childNode(prop, "value");
        if (!valueNode) throw violation(`non-literal value in ${path}.${key}`);
        out[key] = evaluateLiteral(valueNode, `${path}.${key}`);
      }
      return out;
    }
    case "ArrayExpression":
      return asNodeArray(node.elements).map((el, i) => {
        if (!el) throw violation(`sparse arrays not allowed in ${path}`);
        if (el.type === "SpreadElement") throw violation(`spread not allowed in ${path}`);
        return evaluateLiteral(el, `${path}[${i}]`);
      });
    case "Literal":
      return node.value;
    case "TemplateLiteral": {
      const expressions = Array.isArray(node.expressions) ? node.expressions : [];
      if (expressions.length > 0) throw violation(`template interpolation not allowed in ${path}`);
      return asNodeArray(node.quasis)
        .map((q) => quasiValue(q))
        .join("");
    }
    case "UnaryExpression": {
      const arg = childNode(node, "argument");
      if (node.operator === "-" && arg?.type === "Literal" && typeof arg.value === "number") return -arg.value;
      throw violation(`only negative-number unary allowed in ${path}`);
    }
    default:
      throw violation(`non-literal value in ${path}: ${node.type}`);
  }
}

/** Read a template-literal quasi's cooked (fallback raw) string, tolerating either shape. */
function quasiValue(quasi: AstNode | undefined): string {
  const value = quasi?.value;
  if (typeof value !== "object" || value === null) return "";
  const parts: { cooked?: unknown; raw?: unknown } = value;
  if (typeof parts.cooked === "string") return parts.cooked;
  if (typeof parts.raw === "string") return parts.raw;
  return "";
}

function propertyKey(node: AstNode, path: string): string {
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  if (node.type === "Literal" && (typeof node.value === "string" || typeof node.value === "number")) {
    return String(node.value);
  }
  throw violation(`unsupported key in ${path}: ${node.type}`);
}

function validateMeta(meta: unknown): WorkflowMeta {
  if (!meta || typeof meta !== "object") throw violation("meta must be an object");
  const m: Record<string, unknown> = { ...meta };
  const { name, description, whenToUse, harness, phases, output } = m;
  if (typeof name !== "string" || !name.trim()) throw violation("meta.name must be a non-empty string");
  if (typeof description !== "string" || !description.trim()) {
    throw violation("meta.description must be a non-empty string");
  }
  if (whenToUse !== undefined && typeof whenToUse !== "string") {
    throw violation("meta.whenToUse must be a string");
  }
  // Harness is NOT validated here: the sandbox only enforces determinism. The
  // declared `meta.harness` is the single source of truth, but validating it
  // (→ `HarnessNotDeclared`) is the CLI layer's job (`resolveHarness`), so a
  // missing/unknown value is passed through untouched for that gate to report.
  if (phases !== undefined && !Array.isArray(phases)) throw violation("meta.phases must be an array");
  if (output !== undefined && typeof output !== "string") throw violation("meta.output must be a string");
  // `harness` flows through unvalidated (CLI's job). The HarnessId brand is a
  // narrowing the sandbox deliberately doesn't enforce, so accept it as-declared.
  // oxlint-disable-next-line typescript/consistent-type-assertions -- harness is validated downstream by the CLI; the sandbox passes the declared value through
  const declaredHarness = harness as HarnessId;
  return {
    name,
    description,
    ...(whenToUse !== undefined ? { whenToUse } : {}),
    harness: declaredHarness,
    ...(phases !== undefined && Array.isArray(phases) ? { phases } : {}),
    ...(output !== undefined && typeof output === "string" ? { output } : {}),
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
    // Host globals injected for authoring convenience. Both are deterministic (no clocks,
    // no randomness), so they don't violate the journal-replay invariant.
    URL,
    URLSearchParams,
  };

  const context = vm.createContext(sandbox);
  const script = new vm.Script(js, { filename: "workflow.js" });
  const returnValue = await script.runInContext(context);

  return { meta, returnValue };
}
