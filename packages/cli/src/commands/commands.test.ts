import { describe, it, expect } from "vitest";
import type { RunId } from "@workflow/core";
import { ok, err } from "neverthrow";
import type { Result } from "neverthrow";
import type { AgentRunner, AgentRequest, AgentResult, RunCtx, WorkflowError } from "@workflow/core";
import { agentResult, workflowSource } from "@workflow/test-support";
import { dispatch } from "../dispatch.js";
import { runForeground } from "../execute.js";
import { fakeDeps, runMeta } from "../test-support.js";

const GREET_BODY = `phase("Greet");
const msg = await agent("say hi", { label: "greeter" });
return { msg };`;
const HELLO = workflowSource({
  name: "hello",
  description: "say hi",
  harness: "raw-api",
  phases: [{ title: "Greet" }],
  body: GREET_BODY,
});
const HELLO_NO_HARNESS = workflowSource({
  name: "hello",
  description: "say hi",
  phases: [{ title: "Greet" }],
  body: GREET_BODY,
});

describe("dispatch routing", () => {
  it("prints usage and exits non-zero with no command", async () => {
    const { deps, out } = fakeDeps();
    expect(await dispatch([], deps)).toBe(1);
    expect(out()).toContain("Usage:");
  });

  it("list reports no runs", async () => {
    const { deps, out } = fakeDeps();
    expect(await dispatch(["list"], deps)).toBe(0);
    expect(out()).toContain("no runs");
  });

  it("adapters prints the capability matrix", async () => {
    const { deps, out } = fakeDeps();
    await dispatch(["adapters"], deps);
    expect(out()).toContain("raw-api");
    expect(out()).toContain("claude");
  });

  it("an unknown command is reported as an unknown workflow", async () => {
    const { deps, out } = fakeDeps();
    expect(await dispatch(["nope"], deps)).toBe(1);
    expect(out()).toContain("unknown command or workflow 'nope'");
  });

  it("run errors on a missing script", async () => {
    const { deps, out } = fakeDeps();
    expect(await dispatch(["run", "/missing.ts"], deps)).toBe(1);
    expect(out()).toContain("cannot read script");
  });

  it("run rejects invalid --args JSON", async () => {
    const { deps } = fakeDeps({ _files: { "/h.ts": HELLO } });
    const code = await dispatch(["run", "/h.ts", "--args", "{bad", "--yes"], deps);
    expect(code).toBe(1);
  });

  it("run errors when meta.harness is not declared", async () => {
    const { deps, out } = fakeDeps({ _files: { "/h.ts": HELLO_NO_HARNESS } });
    const code = await dispatch(["run", "/h.ts", "--yes"], deps);
    expect(code).toBe(1);
    expect(out()).toContain("HarnessNotDeclared");
  });
});

const INDEX = JSON.stringify({
  version: 1,
  templates: [
    {
      name: "haiku",
      description: "Minimal single-agent workflow",
      harness: "claude",
      complexity: "beginner",
      agents: 1,
      multiFile: false,
      entry: "haiku.workflow.ts",
    },
    {
      name: "pr-review",
      description: "Review a diff",
      harness: "claude",
      complexity: "beginner",
      agents: 1,
      recommended: true,
      multiFile: false,
      entry: "pr-review.workflow.ts",
    },
  ],
});
// A realistic single-file template: object-literal meta (the shape rewriteHarness anchors on),
// not the JSON-style meta workflowSource emits.
const HAIKU_TPL = `import { agent, defineWorkflow } from "defineworkflow";

export default defineWorkflow({
  name: "haiku",
  description: "Minimal single-agent workflow",
  harness: "claude",
  async run() {
    const r = await agent("write a haiku", { label: "haiku" });
    return { r };
  },
});
`;

describe("dispatch list-templates", () => {
  it("prints a table with each name and a ★ on the recommended one", async () => {
    const { deps, out } = fakeDeps({
      env: { templatesDir: "/t" },
      _files: { "/t/index.json": INDEX },
    });
    expect(await dispatch(["list-templates"], deps)).toBe(0);
    expect(out()).toContain("haiku");
    expect(out()).toContain("pr-review ★");
  });

  it("--json emits parseable JSON of all entries", async () => {
    const { deps, out } = fakeDeps({
      env: { templatesDir: "/t" },
      _files: { "/t/index.json": INDEX },
    });
    expect(await dispatch(["list-templates", "--json"], deps)).toBe(0);
    const parsed = JSON.parse(out());
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("haiku");
  });

  it("missing index → exit 1 + message", async () => {
    const { deps, out } = fakeDeps({ env: { templatesDir: "/t" } });
    expect(await dispatch(["list-templates"], deps)).toBe(1);
    expect(out()).toContain("not found");
  });
});

describe("dispatch init", () => {
  /** A fakeDeps whose io is a single in-memory map, so writes/exists/readText all agree. */
  function initDeps(extra: Parameters<typeof fakeDeps>[0] = {}) {
    const files = new Map<string, string>([
      ["/t/index.json", INDEX],
      ["/t/haiku.workflow.ts", HAIKU_TPL],
    ]);
    const { env: envExtra, io: ioExtra, ...rest } = extra;
    const base = fakeDeps({
      env: { templatesDir: "/t", cwd: "/proj", ...envExtra },
      io: {
        readText: (p) => files.get(p),
        writeText: (p, d) => void files.set(p, d),
        exists: (p) => files.has(p),
        readDir: () => [],
        ...ioExtra,
      },
      ...rest,
    });
    return { ...base, files };
  }

  it("scaffolds a single-file template into cwd", async () => {
    const { deps, files } = initDeps();
    expect(await dispatch(["init", "haiku", "--no-run"], deps)).toBe(0);
    expect(files.has("/proj/haiku.workflow.ts")).toBe(true);
  });

  it("refuses to overwrite an existing file (non-TTY) without --force", async () => {
    const { deps, out } = initDeps();
    await dispatch(["init", "haiku", "--no-run"], deps);
    expect(await dispatch(["init", "haiku", "--no-run"], deps)).toBe(1);
    expect(out()).toContain("already exists");
  });

  it("--force overwrites", async () => {
    const { deps } = initDeps();
    await dispatch(["init", "haiku", "--no-run"], deps);
    expect(await dispatch(["init", "haiku", "--no-run", "--force"], deps)).toBe(0);
  });

  it("--dry-run writes nothing and lists the plan", async () => {
    const { deps, out, files } = initDeps();
    expect(await dispatch(["init", "haiku", "--dry-run"], deps)).toBe(0);
    expect(files.has("/proj/haiku.workflow.ts")).toBe(false);
    expect(out()).toContain("would write");
  });

  it("unknown template → exit 1", async () => {
    const { deps, out } = initDeps();
    expect(await dispatch(["init", "nope", "--no-run"], deps)).toBe(1);
    expect(out()).toContain("unknown template");
  });

  it("rewrites the harness to a detected one", async () => {
    const { deps, files } = initDeps({ adapters: { detected: ["codex"] } });
    await dispatch(["init", "haiku", "--no-run"], deps);
    expect(files.get("/proj/haiku.workflow.ts")).toContain('harness: "codex"');
  });

  it("falls back to raw-api when nothing detected but ANTHROPIC_API_KEY is set", async () => {
    const { deps, files } = initDeps({ env: { vars: { ANTHROPIC_API_KEY: "x" } } });
    await dispatch(["init", "haiku", "--no-run"], deps);
    expect(files.get("/proj/haiku.workflow.ts")).toContain('harness: "raw-api"');
  });

  it("with no template shows the gallery", async () => {
    const { deps, out } = initDeps();
    expect(await dispatch(["init"], deps)).toBe(0);
    expect(out()).toContain("Available templates");
  });

  it("copies every file of a multi-file template, rewriting harness only on the entry", async () => {
    const MULTI_INDEX = JSON.stringify({
      version: 1,
      templates: [
        {
          name: "mf",
          description: "multi",
          harness: "claude",
          multiFile: true,
          dir: "mf",
          entry: "entry.workflow.ts",
        },
      ],
    });
    const files = new Map<string, string>([
      ["/t/index.json", MULTI_INDEX],
      ["/t/mf/entry.workflow.ts", 'export default defineWorkflow({\n  harness: "claude",\n});\n'],
      ["/t/mf/schemas.ts", "export const S = 1;\n"],
    ]);
    const { deps } = fakeDeps({
      env: { templatesDir: "/t", cwd: "/proj" },
      adapters: { detected: ["codex"] },
      io: {
        readText: (p) => files.get(p),
        writeText: (p, d) => void files.set(p, d),
        exists: (p) => files.has(p),
        readDir: (dir) => (dir === "/t/mf" ? ["entry.workflow.ts", "schemas.ts"] : []),
      },
    });
    expect(await dispatch(["init", "mf", "--no-run"], deps)).toBe(0);
    expect(files.get("/proj/mf/entry.workflow.ts")).toContain('harness: "codex"');
    // helper copied verbatim (not harness-rewritten)
    expect(files.get("/proj/mf/schemas.ts")).toBe("export const S = 1;\n");
  });
});

describe("dispatch run (end-to-end, line-log)", () => {
  it("runs a workflow via the raw-api adapter and persists a finished run", async () => {
    const { deps, out } = fakeDeps({ _files: { "/h.ts": HELLO } });

    const code = await dispatch(["run", "/h.ts", "--yes"], deps);
    expect(code).toBe(0);

    const runs = deps.registry.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.name).toBe("hello");
    expect(runs[0]!.status).toBe("finished");
    expect(runs[0]!.adapter).toBe("raw-api");
    // line-log output records the run + the finished agent
    expect(out()).toContain("hello");
    expect(out()).toContain("greeter");
  });

  const ASK_BODY = `const env = await askUserQuestion({ key: "deploy-target", question: "Where to deploy?", choices: ["staging", "production"] });
return { env };`;
  const ASK = workflowSource({
    name: "ask",
    description: "asks",
    harness: "raw-api",
    body: ASK_BODY,
  });

  it("resolves askUserQuestion from --answers in a non-interactive run", async () => {
    const { deps } = fakeDeps({ _files: { "/a.ts": ASK } });
    const code = await dispatch(
      ["run", "/a.ts", "--yes", "--answers", '{"deploy-target":"staging"}'],
      deps,
    );
    expect(code).toBe(0);
    expect(deps.registry.listRuns()[0]!.status).toBe("finished");
  });

  it("fails fast with UnansweredQuestion when no answer is supplied non-interactively", async () => {
    const { deps, out } = fakeDeps({ _files: { "/a.ts": ASK } });
    const code = await dispatch(["run", "/a.ts", "--yes"], deps);
    expect(code).toBe(1);
    expect(out()).toContain("UnansweredQuestion");
    expect(deps.registry.listRuns()[0]!.status).toBe("failed");
  });
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

interface ControllableRunner extends AgentRunner {
  callCount(label: string): number;
  resolve(label: string, text: string): void;
}
function createControllableRunner(): ControllableRunner {
  const counts = new Map<string, number>();
  const pending = new Map<string, Array<Deferred<Result<AgentResult, WorkflowError>>>>();
  return {
    id: "scripted",
    capabilities: { nativeSchema: true, reportsTokens: true, toolEvents: false },
    run: (req: AgentRequest, _ctx: RunCtx) => {
      const label = req.label ?? "";
      counts.set(label, (counts.get(label) ?? 0) + 1);
      const d = deferred<Result<AgentResult, WorkflowError>>();
      const stack = pending.get(label) ?? [];
      stack.push(d);
      pending.set(label, stack);
      req.signal.addEventListener("abort", () =>
        d.resolve(err({ kind: "AdapterSpawn", adapter: "scripted", cause: "agent stopped" })),
      );
      return d.promise;
    },
    callCount: (label) => counts.get(label) ?? 0,
    resolve: (label, text) => {
      const s = pending.get(label);
      const d = s?.[s.length - 1];
      if (d) d.resolve(ok(agentResult({ text })));
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("runForeground agent control", () => {
  it("agent-scoped stop fails just that agent, others finish", async () => {
    const SOURCE = `export const meta = { name: "t", description: "d" } as const
const r = await parallel([() => agent("x", { label: "a" }), () => agent("y", { label: "b" })]);
return r;`;

    let onAction!: (a: import("@workflow/ui").UiAction) => void;
    const { deps } = fakeDeps({
      ui: {
        start: (opts) => {
          onAction = opts.onAction!;
          return { unmount() {} };
        },
      },
    });
    deps.registry.init(runMeta({ runId: "r1" as RunId, name: "t" }), SOURCE);

    const runner = createControllableRunner();
    const p = runForeground(deps, {
      runId: "r1" as RunId,
      source: SOURCE,
      args: {},
      runner,
      adapter: "codex",
      seed: [],
    });
    await flush();

    expect(runner.callCount("a")).toBe(1);
    expect(runner.callCount("b")).toBe(1);

    onAction({ type: "stop", target: { scope: "agent", key: "0:default:a" } });
    runner.resolve("b", "done-b");

    const code = await p;
    expect(code).toBe(0);

    const events = deps.registry.readEvents("r1");
    expect(events.some((e) => e.type === "agent-failed" && e.key === "0:default:a")).toBe(true);
    expect(events.some((e) => e.type === "agent-finished" && e.key === "1:default:b")).toBe(true);
  });

  it("restart yields a second runner call", async () => {
    const SOURCE2 = `export const meta = { name: "t", description: "d" } as const
const v = await agent("x", { label: "a" });
return v;`;

    let onAction!: (a: import("@workflow/ui").UiAction) => void;
    const { deps } = fakeDeps({
      ui: {
        start: (opts) => {
          onAction = opts.onAction!;
          return { unmount() {} };
        },
      },
    });
    deps.registry.init(runMeta({ runId: "r2" as RunId, name: "t" }), SOURCE2);

    const runner = createControllableRunner();
    const p = runForeground(deps, {
      runId: "r2" as RunId,
      source: SOURCE2,
      args: {},
      runner,
      adapter: "codex",
      seed: [],
    });
    await flush();

    expect(runner.callCount("a")).toBe(1);

    onAction({ type: "restart", key: "0:default:a" });
    await flush();
    await flush();
    expect(runner.callCount("a")).toBe(2);

    runner.resolve("a", "second");
    const code = await p;
    expect(code).toBe(0);
    expect(runner.callCount("a")).toBe(2);

    const events = deps.registry.readEvents("r2");
    expect(events.some((e) => e.type === "agent-failed" && e.key === "0:default:a")).toBe(false);
  });
});
