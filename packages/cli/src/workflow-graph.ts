import { transformSync } from "esbuild";
import { parse } from "acorn";
import type { HarnessId, WorkflowMeta } from "@workflow/core";

export type WorkflowGraphWarningCode =
  | "DynamicLoop"
  | "DynamicAgentPrompt"
  | "DynamicParallel"
  | "UnsupportedSyntax"
  | "UnknownNestedWorkflow";

export interface WorkflowGraphWarning {
  readonly code: WorkflowGraphWarningCode;
  readonly message: string;
  readonly location?: {
    readonly file: string;
    readonly line: number;
    readonly column: number;
  };
}

export type WorkflowGraphNode =
  | { readonly type: "workflow"; readonly id: string; readonly label: string }
  | { readonly type: "phase"; readonly id: string; readonly label: string }
  | {
      readonly type: "agent";
      readonly id: string;
      readonly label: string;
      readonly hasSchema: boolean;
    }
  | { readonly type: "parallel"; readonly id: string; readonly label: string }
  | { readonly type: "join"; readonly id: string; readonly label: string }
  | { readonly type: "pipeline"; readonly id: string; readonly label: string }
  | { readonly type: "stage"; readonly id: string; readonly label: string }
  | {
      readonly type: "question";
      readonly id: string;
      readonly label: string;
      readonly key?: string;
    }
  | {
      readonly type: "nested-workflow";
      readonly id: string;
      readonly label: string;
      readonly target: string;
    }
  | { readonly type: "output"; readonly id: string; readonly label: string }
  | { readonly type: "dynamic"; readonly id: string; readonly label: string };

export interface WorkflowGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly kind:
    | "sequence"
    | "parallel-branch"
    | "pipeline-stage"
    | "contains"
    | "returns"
    | "dynamic";
}

export interface WorkflowGraph {
  readonly workflow: {
    readonly name: string;
    readonly description: string;
    readonly harness: HarnessId;
  };
  readonly nodes: readonly WorkflowGraphNode[];
  readonly edges: readonly WorkflowGraphEdge[];
  readonly warnings: readonly WorkflowGraphWarning[];
}

interface BuildWorkflowGraphInput {
  readonly file: string;
  readonly source: string;
  readonly meta: WorkflowMeta;
  /** Set false when `source` is generated/bundled and locations would point at the wrong file. */
  readonly includeLocations?: boolean;
}

type AstNode = { readonly type: string; readonly [key: string]: unknown };
type KnownCallName = "phase" | "agent" | "parallel" | "pipeline" | "askUserQuestion" | "workflow";
type EdgeKind = WorkflowGraphEdge["kind"];

type Flow = { readonly exits: readonly string[] };

const MAX_LABEL = 60;

/** Build a best-effort static graph from a bundled workflow source string. */
export function buildWorkflowGraph(input: BuildWorkflowGraphInput): WorkflowGraph {
  const source = stripTypeScript(input.source, input.file);
  const program = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
  const builder = new GraphBuilder(
    input.file,
    asNode(program),
    input.meta,
    input.includeLocations ?? true,
  );
  return builder.build();
}

class GraphBuilder {
  private readonly nodes: WorkflowGraphNode[] = [];
  private readonly edges: WorkflowGraphEdge[] = [];
  private readonly edgeKeys = new Set<string>();
  private readonly warnings: WorkflowGraphWarning[] = [];
  private readonly counters = new Map<string, number>();
  private readonly phasesByLabel = new Map<string, string>();
  private readonly rootId: string;
  private runtimePhaseCalls = 0;

  constructor(
    private readonly file: string,
    private readonly program: AstNode,
    private readonly meta: WorkflowMeta,
    private readonly includeLocations: boolean,
  ) {
    this.rootId = this.addNode({ type: "workflow", id: "root", label: meta.name });
  }

  build(): WorkflowGraph {
    const metaPhaseIds = this.addMetaPhases();
    const runBody = this.findRunBody();
    let exits: readonly string[] = [this.rootId];

    if (runBody) {
      exits = this.processStatements(asNodeArray(runBody.body), [this.rootId]).exits;
    } else {
      const legacyStatements = this.legacyBodyStatements();
      if (legacyStatements.length > 0) {
        exits = this.processStatements(legacyStatements, [this.rootId]).exits;
      } else {
        this.warn(
          "UnsupportedSyntax",
          "Could not find a defineWorkflow run() body; graph only includes metadata.",
          this.program,
        );
      }
    }

    if (this.runtimePhaseCalls === 0) this.connectMetaPhaseSequence(metaPhaseIds);

    if (this.meta.output !== undefined) {
      const out = this.addNode({ type: "output", id: "output", label: this.meta.output });
      const outputFrom =
        exits.length === 1 && exits[0] === this.rootId && metaPhaseIds.length > 0
          ? [metaPhaseIds[metaPhaseIds.length - 1]!]
          : exits;
      this.connect(outputFrom, out, "returns");
    }

    return {
      workflow: {
        name: this.meta.name,
        description: this.meta.description,
        harness: this.meta.harness,
      },
      nodes: this.nodes,
      edges: this.edges,
      warnings: this.warnings,
    };
  }

  private addMetaPhases(): string[] {
    const phases = this.meta.phases ?? [];
    const ids: string[] = [];
    phases.forEach((phase, index) => {
      const label = phaseLabel(phase) ?? `phase ${index + 1}`;
      ids.push(this.ensurePhase(label));
    });
    return ids;
  }

  private connectMetaPhaseSequence(ids: readonly string[]): void {
    let prev = this.rootId;
    for (const id of ids) {
      this.addEdge(prev, id, "sequence");
      prev = id;
    }
  }

  private findRunBody(): AstNode | undefined {
    let body: AstNode | undefined;
    visitAst(this.program, (node) => {
      if (body || node.type !== "CallExpression" || identifierCallName(node) !== "defineWorkflow")
        return "continue";
      const definition = asNodeArray(node.arguments)[0];
      if (!definition || definition.type !== "ObjectExpression") return "continue";
      const run = asNodeArray(definition.properties).find(
        (property) => propertyName(childNode(property, "key")) === "run",
      );
      const value = run?.type === "Property" ? childNode(run, "value") : undefined;
      if (value?.type === "FunctionExpression" || value?.type === "ArrowFunctionExpression") {
        const candidate = childNode(value, "body");
        if (candidate?.type === "BlockStatement") body = candidate;
      }
      return "continue";
    });
    return body;
  }

  private legacyBodyStatements(): readonly AstNode[] {
    return asNodeArray(this.program.body).filter((statement) => {
      if (statement.type === "ImportDeclaration" || statement.type === "ExportDefaultDeclaration")
        return false;
      if (statement.type === "ExportNamedDeclaration") {
        const declaration = childNode(statement, "declaration");
        if (!declaration) return false;
        if (declaration.type === "VariableDeclaration") {
          return !asNodeArray(declaration.declarations).some(
            (decl) => propertyName(childNode(decl, "id")) === "meta",
          );
        }
        return true;
      }
      return true;
    });
  }

  private processStatements(
    statements: readonly AstNode[],
    starts: readonly string[],
    firstEdgeKind?: EdgeKind,
  ): Flow {
    let exits: readonly string[] = unique(starts);
    let pendingFirst = firstEdgeKind;
    for (const statement of statements) {
      exits = this.processNode(statement, exits, pendingFirst).exits;
      pendingFirst = undefined;
    }
    return { exits };
  }

  private processNode(node: AstNode, starts: readonly string[], firstEdgeKind?: EdgeKind): Flow {
    if (isLoop(node)) {
      const dynamic = this.addNode({
        type: "dynamic",
        id: this.nextId("dynamic_loop"),
        label: "dynamic loop",
      });
      this.connect(starts, dynamic, firstEdgeKind ?? "dynamic");
      this.warn("DynamicLoop", "Loop bounds are dynamic; nested calls are approximate.", node);
      const body = childNode(node, "body");
      const bodyFlow = body
        ? this.processStatementOrBlock(body, [dynamic], "dynamic")
        : { exits: [dynamic] };
      return { exits: unique([dynamic, ...bodyFlow.exits]) };
    }

    if (node.type === "IfStatement") {
      const dynamic = this.addNode({
        type: "dynamic",
        id: this.nextId("dynamic_conditional"),
        label: "conditional",
      });
      this.connect(starts, dynamic, firstEdgeKind ?? "dynamic");
      this.warn(
        "UnsupportedSyntax",
        "Conditional control flow is represented approximately.",
        node,
      );
      const consequent = childNode(node, "consequent");
      const alternate = childNode(node, "alternate");
      const thenFlow = consequent
        ? this.processStatementOrBlock(consequent, [dynamic], "dynamic")
        : { exits: [dynamic] };
      const elseFlow = alternate
        ? this.processStatementOrBlock(alternate, [dynamic], "dynamic")
        : { exits: [dynamic] };
      return { exits: unique([...thenFlow.exits, ...elseFlow.exits]) };
    }

    const calls = collectKnownCalls(node);
    let exits: readonly string[] = unique(starts);
    let pendingFirst = firstEdgeKind;
    for (const call of calls) {
      exits = this.processCall(call, exits, pendingFirst).exits;
      pendingFirst = undefined;
    }
    return { exits };
  }

  private processStatementOrBlock(
    node: AstNode,
    starts: readonly string[],
    firstEdgeKind?: EdgeKind,
  ): Flow {
    if (node.type === "BlockStatement")
      return this.processStatements(asNodeArray(node.body), starts, firstEdgeKind);
    return this.processNode(node, starts, firstEdgeKind);
  }

  private processCall(call: AstNode, starts: readonly string[], firstEdgeKind?: EdgeKind): Flow {
    const name = callName(call);
    switch (name) {
      case "phase": {
        this.runtimePhaseCalls += 1;
        const label = staticText(asNodeArray(call.arguments)[0]) ?? "dynamic phase";
        const id = this.ensurePhase(label);
        this.connect(starts, id, firstEdgeKind ?? "sequence");
        return { exits: [id] };
      }
      case "agent": {
        const info = this.agentInfo(call);
        const id = this.addNode({
          type: "agent",
          id: this.nextId(`agent_${slug(info.label)}`),
          label: info.label,
          hasSchema: info.hasSchema,
        });
        this.connect(starts, id, firstEdgeKind ?? "sequence");
        return { exits: [id] };
      }
      case "parallel":
        return this.processParallel(call, starts, firstEdgeKind);
      case "pipeline":
        return this.processPipeline(call, starts, firstEdgeKind);
      case "askUserQuestion": {
        const info = questionInfo(call);
        const node =
          info.key === undefined
            ? {
                type: "question" as const,
                id: this.nextId(`question_${slug(info.label)}`),
                label: info.label,
              }
            : {
                type: "question" as const,
                id: this.nextId(`question_${slug(info.key)}`),
                label: info.label,
                key: info.key,
              };
        const id = this.addNode(node);
        this.connect(starts, id, firstEdgeKind ?? "sequence");
        return { exits: [id] };
      }
      case "workflow": {
        const target = staticText(asNodeArray(call.arguments)[0]);
        if (target === undefined)
          this.warn("UnknownNestedWorkflow", "Nested workflow target is dynamic.", call);
        const labelTarget = target ?? "<dynamic>";
        const id = this.addNode({
          type: "nested-workflow",
          id: this.nextId(`nested_${slug(labelTarget)}`),
          label: `nested workflow: ${labelTarget}`,
          target: labelTarget,
        });
        this.connect(starts, id, firstEdgeKind ?? "sequence");
        return { exits: [id] };
      }
      default:
        return { exits: starts };
    }
  }

  private processParallel(
    call: AstNode,
    starts: readonly string[],
    firstEdgeKind?: EdgeKind,
  ): Flow {
    const parallelId = this.addNode({
      type: "parallel",
      id: this.nextId("parallel"),
      label: "parallel",
    });
    this.connect(starts, parallelId, firstEdgeKind ?? "sequence");
    const branches = asNodeArray(call.arguments)[0];
    const branchExits: string[] = [];

    if (!branches || branches.type !== "ArrayExpression") {
      this.warn("DynamicParallel", "parallel() branches are not a static array literal.", call);
      branchExits.push(
        this.addDynamicChild(
          parallelId,
          "dynamic_parallel",
          "dynamic parallel branches",
          "dynamic",
        ),
      );
    } else {
      asNodeArray(branches.elements).forEach((branch, index) => {
        if (isFunctionLike(branch)) {
          branchExits.push(
            ...this.processFunctionLike(branch, [parallelId], "parallel-branch").exits,
          );
          return;
        }
        this.warn(
          "DynamicParallel",
          "parallel() branch is not a statically inspectable function.",
          branch,
        );
        branchExits.push(
          this.addDynamicChild(
            parallelId,
            "dynamic_branch",
            `branch ${index + 1}`,
            "parallel-branch",
          ),
        );
      });
    }

    const join = this.addNode({ type: "join", id: this.nextId("parallel_join"), label: "join" });
    this.connect(branchExits.length > 0 ? branchExits : [parallelId], join, "sequence");
    return { exits: [join] };
  }

  private processPipeline(
    call: AstNode,
    starts: readonly string[],
    firstEdgeKind?: EdgeKind,
  ): Flow {
    const pipelineId = this.addNode({
      type: "pipeline",
      id: this.nextId("pipeline"),
      label: "pipeline",
    });
    this.connect(starts, pipelineId, firstEdgeKind ?? "sequence");
    let exits: readonly string[] = [pipelineId];
    asNodeArray(call.arguments)
      .slice(1)
      .forEach((stage, index) => {
        const label = stageLabel(stage) ?? `stage ${index + 1}`;
        const stageId = this.addNode({
          type: "stage",
          id: this.nextId(`stage_${slug(label)}`),
          label: `stage: ${label}`,
        });
        this.connect(exits, stageId, "pipeline-stage");
        exits = isFunctionLike(stage)
          ? this.processFunctionLike(stage, [stageId], "contains").exits
          : [stageId];
      });
    return { exits };
  }

  private processFunctionLike(
    fn: AstNode,
    starts: readonly string[],
    firstEdgeKind: EdgeKind,
  ): Flow {
    const body = childNode(fn, "body");
    if (!body) return { exits: starts };
    return this.processStatementOrBlock(body, starts, firstEdgeKind);
  }

  private agentInfo(call: AstNode): { readonly label: string; readonly hasSchema: boolean } {
    const opts = objectArg(call, 1);
    const label = stringProperty(opts, "label");
    const prompt = asNodeArray(call.arguments)[0];
    const promptText = promptPreview(prompt);
    if (prompt && promptText.dynamic) {
      this.warn(
        "DynamicAgentPrompt",
        "Agent prompt is dynamic; using an approximate preview.",
        prompt,
      );
    }
    return {
      label: shorten(label ?? promptText.text ?? "agent"),
      hasSchema: hasObjectProperty(opts, "schema"),
    };
  }

  private addDynamicChild(
    parent: string,
    idPrefix: string,
    label: string,
    edgeKind: EdgeKind,
  ): string {
    const id = this.addNode({ type: "dynamic", id: this.nextId(idPrefix), label });
    this.addEdge(parent, id, edgeKind);
    return id;
  }

  private ensurePhase(label: string): string {
    const existing = this.phasesByLabel.get(label);
    if (existing) return existing;
    const id = this.addNode({ type: "phase", id: this.nextId(`phase_${slug(label)}`), label });
    this.phasesByLabel.set(label, id);
    return id;
  }

  private addNode(node: WorkflowGraphNode): string {
    this.nodes.push(node);
    return node.id;
  }

  private connect(from: readonly string[], to: string, kind: EdgeKind, label?: string): void {
    for (const id of unique(from)) this.addEdge(id, to, kind, label);
  }

  private addEdge(from: string, to: string, kind: EdgeKind, label?: string): void {
    if (from === to) return;
    const key = `${from}\0${to}\0${kind}\0${label ?? ""}`;
    if (this.edgeKeys.has(key)) return;
    this.edgeKeys.add(key);
    const edge = label === undefined ? { from, to, kind } : { from, to, kind, label };
    this.edges.push(edge);
  }

  private nextId(prefix: string): string {
    const safe = prefix || "node";
    const next = (this.counters.get(safe) ?? 0) + 1;
    this.counters.set(safe, next);
    return next === 1 ? safe : `${safe}_${next}`;
  }

  private warn(code: WorkflowGraphWarningCode, message: string, node: AstNode): void {
    const loc = this.includeLocations ? nodeLoc(this.file, node) : undefined;
    this.warnings.push(loc === undefined ? { code, message } : { code, message, location: loc });
  }
}

function stripTypeScript(source: string, file: string): string {
  return transformSync(source, { loader: "ts", format: "esm", sourcefile: file }).code;
}

function collectKnownCalls(root: AstNode): AstNode[] {
  const calls: AstNode[] = [];
  visitAst(root, (node) => {
    if (node.type === "CallExpression" && callName(node) !== undefined) {
      calls.push(node);
      return "skip";
    }
    if (node !== root && isFunctionLike(node)) return "skip";
    return "continue";
  });
  return calls.toSorted((a, b) => nodeStart(a) - nodeStart(b));
}

function visitAst(root: AstNode, fn: (node: AstNode) => "continue" | "skip"): void {
  const action = fn(root);
  if (action === "skip") return;
  for (const value of Object.values(root)) {
    if (isAstNode(value)) visitAst(value, fn);
    if (Array.isArray(value)) {
      for (const item of value) if (isAstNode(item)) visitAst(item, fn);
    }
  }
}

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"
  );
}

function asNode(value: unknown): AstNode {
  if (!isAstNode(value)) throw new Error("expected AST node");
  return value;
}

function asNodeArray(value: unknown): AstNode[] {
  return Array.isArray(value) ? value.filter(isAstNode) : [];
}

function childNode(node: AstNode | undefined, key: string): AstNode | undefined {
  const value = node?.[key];
  return isAstNode(value) ? value : undefined;
}

function isLoop(node: AstNode): boolean {
  return (
    node.type === "ForStatement" ||
    node.type === "ForInStatement" ||
    node.type === "ForOfStatement" ||
    node.type === "WhileStatement"
  );
}

function isFunctionLike(node: AstNode | undefined): node is AstNode {
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionExpression" ||
    node?.type === "FunctionDeclaration"
  );
}

function identifierCallName(call: AstNode): string | undefined {
  const expression = childNode(call, "callee");
  return propertyName(expression);
}

function callName(call: AstNode): KnownCallName | undefined {
  const name = identifierCallName(call);
  switch (name) {
    case "phase":
    case "agent":
    case "parallel":
    case "pipeline":
    case "askUserQuestion":
    case "workflow":
      return name;
    default:
      return undefined;
  }
}

function propertyName(node: AstNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  if ((node.type === "Literal" || node.type === "PropertyName") && typeof node.value === "string")
    return node.value;
  return undefined;
}

function objectArg(call: AstNode, index: number): AstNode | undefined {
  const arg = asNodeArray(call.arguments)[index];
  return arg?.type === "ObjectExpression" ? arg : undefined;
}

function objectProperty(object: AstNode | undefined, key: string): AstNode | undefined {
  if (!object) return undefined;
  return asNodeArray(object.properties).find(
    (property) => propertyName(childNode(property, "key")) === key,
  );
}

function hasObjectProperty(object: AstNode | undefined, key: string): boolean {
  return objectProperty(object, key) !== undefined;
}

function stringProperty(object: AstNode | undefined, key: string): string | undefined {
  return staticText(childNode(objectProperty(object, key), "value"));
}

function questionInfo(call: AstNode): { readonly label: string; readonly key?: string } {
  const opts = objectArg(call, 0);
  const key = stringProperty(opts, "key");
  const question = stringProperty(opts, "question");
  const label = key ?? shorten(question ?? "question");
  return key === undefined ? { label } : { label, key };
}

function stageLabel(node: AstNode): string | undefined {
  if (node.type === "Identifier") return propertyName(node);
  if (node.type === "MemberExpression") return propertyName(childNode(node, "property"));
  if (isFunctionLike(node)) return propertyName(childNode(node, "id"));
  return undefined;
}

function staticText(node: AstNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && asNodeArray(node.expressions).length === 0) {
    return asNodeArray(node.quasis).map(templateElementText).join("");
  }
  return undefined;
}

function promptPreview(node: AstNode | undefined): {
  readonly text?: string;
  readonly dynamic: boolean;
} {
  if (!node) return { dynamic: false };
  const text = staticText(node);
  if (text !== undefined) return { text: shorten(text), dynamic: false };
  if (node.type === "TemplateLiteral") {
    const quasis = asNodeArray(node.quasis).map(templateElementText);
    const pieces = quasis.flatMap((quasi, index) =>
      index === quasis.length - 1 ? [quasi] : [quasi, "${...}"],
    );
    return { text: shorten(pieces.join("")), dynamic: true };
  }
  return { text: "<dynamic prompt>", dynamic: true };
}

function templateElementText(node: AstNode): string {
  const cooked = unknownProperty(node.value, "cooked");
  const raw = unknownProperty(node.value, "raw");
  if (typeof cooked === "string") return cooked;
  return typeof raw === "string" ? raw : "";
}

function phaseLabel(phase: unknown): string | undefined {
  if (typeof phase === "string" && phase.trim()) return phase;
  if (typeof phase === "object" && phase !== null) {
    const candidate: { title?: unknown; name?: unknown; label?: unknown } = phase;
    if (typeof candidate.title === "string" && candidate.title.trim()) return candidate.title;
    if (typeof candidate.name === "string" && candidate.name.trim()) return candidate.name;
    if (typeof candidate.label === "string" && candidate.label.trim()) return candidate.label;
  }
  return undefined;
}

function nodeStart(node: AstNode): number {
  return typeof node.start === "number" ? node.start : 0;
}

function nodeLoc(file: string, node: AstNode): WorkflowGraphWarning["location"] | undefined {
  const start = unknownProperty(node.loc, "start");
  const line = unknownProperty(start, "line");
  const column = unknownProperty(start, "column");
  return typeof line === "number" && typeof column === "number"
    ? { file, line, column: column + 1 }
    : undefined;
}

function unknownProperty(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function shorten(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_LABEL) return clean;
  return `${clean.slice(0, MAX_LABEL - 1)}…`;
}

function slug(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safe || "node";
}
