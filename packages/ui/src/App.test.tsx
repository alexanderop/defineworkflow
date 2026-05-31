import { describe, it, expect } from "vitest";
import type { RunId } from "@workflow/core";
import { render } from "ink-testing-library";
import type { WorkflowEvent } from "@workflow/core";
import { App, type UiAction } from "./App.js";

const events: WorkflowEvent[] = [
  { type: "run-started", runId: "r1" as RunId, name: "deep-research", at: 0 },
  { type: "phase-started", phase: "Scope", at: 1 },
  { type: "phase-started", phase: "Search", at: 2 },
  { type: "agent-queued", key: "k0", label: "angle-0", phase: "Search", prompt: "Search X", at: 3 },
  { type: "agent-started", key: "k0", at: 4 },
  { type: "agent-output", key: "k0", chunk: "found stuff", at: 5 },
  {
    type: "agent-finished",
    key: "k0",
    usage: { inputTokens: 1, outputTokens: 17 },
    cached: false,
    at: 6,
  },
];

const KEY = { down: "[B", up: "[A", right: "[C", left: "[D", esc: "" };
// Let ink's useInput effect attach its stdin listener, and let state-driven
// re-renders (which refresh the input handler's refs) commit between keypresses.
const tick = () => new Promise((r) => setTimeout(r, 10));

describe("App", () => {
  it("renders the header and all three columns from the event stream", () => {
    const { lastFrame } = render(<App events={events} adapter="codex" animate={false} now={10} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("deep-research");
    expect(frame).toContain("Phases");
    expect(frame).toContain("Scope");
    expect(frame).not.toContain("Scope 0/0"); // 0-agent phases omit the count
    expect(frame).toContain("Search 1/1");
    expect(frame).toContain("1/1 agent"); // header agent counts
    expect(frame).toContain("Scope · 0 agents"); // agents column header for the selected phase
    expect(frame).not.toContain("╭");
    expect(frame).not.toContain("╰");
    expect(frame).not.toContain("found stuff"); // overview mode does not render the detail pane
  });

  it("right-arrow focuses agents so the selected phase's agents show, then detail", async () => {
    const { lastFrame, stdin } = render(<App events={events} animate={false} />);
    await tick();
    stdin.write(KEY.down); // select phase index 1 (Search)
    await tick();
    stdin.write(KEY.right); // focus agents
    await tick();
    expect(lastFrame() ?? "").toContain("Search · 1 agent");
    expect(lastFrame() ?? "").toContain("angle-0");
    stdin.write(KEY.right); // focus detail
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Search · 1 agent");
    expect(frame).toContain("angle-0");
    expect(frame).toContain("Completed");
    expect(frame).toContain("found stuff");
    expect(frame).not.toContain("Phases");
  });

  it("emits pause/stop/save actions via onAction", async () => {
    const actions: UiAction[] = [];
    const { stdin } = render(
      <App events={events} animate={false} onAction={(a) => actions.push(a)} />,
    );
    await tick();
    stdin.write("p");
    await tick();
    stdin.write("x"); // focus is phases → stop whole run
    await tick();
    stdin.write("s");
    await tick();
    expect(actions).toEqual([
      { type: "pause" },
      { type: "stop", target: { scope: "run" } },
      { type: "save" },
    ]);
  });

  it("shows the question prompt and emits an answer action on selection", async () => {
    const qEvents: WorkflowEvent[] = [
      { type: "run-started", runId: "r" as RunId, name: "wf", at: 0 },
      {
        type: "question-asked",
        key: "deploy-target",
        question: "## Where to deploy?",
        choices: ["staging", "production"],
        at: 1,
      },
    ];
    const actions: UiAction[] = [];
    const { lastFrame, stdin } = render(
      <App events={qEvents} animate={false} onAction={(a) => actions.push(a)} />,
    );
    await tick();
    expect(lastFrame() ?? "").toContain("Where to deploy?");
    stdin.write(KEY.down); // highlight "production"
    await tick();
    stdin.write("\r"); // submit
    await tick();
    expect(actions).toEqual([{ type: "answer", key: "deploy-target", value: "production" }]);
  });

  it("stops processing nav keys while a question is pending", async () => {
    const qEvents: WorkflowEvent[] = [
      { type: "run-started", runId: "r" as RunId, name: "wf", at: 0 },
      { type: "question-asked", key: "k", question: "Name?", at: 1 },
    ];
    const actions: UiAction[] = [];
    const { stdin } = render(
      <App events={qEvents} animate={false} onAction={(a) => actions.push(a)} />,
    );
    await tick();
    stdin.write("p"); // would normally pause — must be swallowed by the prompt
    await tick();
    expect(actions).toEqual([]);
  });

  it("stop targets the selected agent when focus is on agents/detail", async () => {
    const actions: UiAction[] = [];
    const { stdin } = render(
      <App events={events} animate={false} onAction={(a) => actions.push(a)} />,
    );
    await tick();
    stdin.write(KEY.down); // Search
    await tick();
    stdin.write(KEY.right); // focus agents (selects angle-0 = key k0)
    await tick();
    stdin.write("x");
    await tick();
    expect(actions).toEqual([{ type: "stop", target: { scope: "agent", key: "k0" } }]);
  });

  it("up/down move the agent selection within a multi-agent phase when focused on agents", async () => {
    const multi: WorkflowEvent[] = [
      { type: "run-started", runId: "r1" as RunId, name: "wf", at: 0 },
      { type: "phase-started", phase: "Scope", at: 1 },
      { type: "phase-started", phase: "Search", at: 2 },
      { type: "agent-queued", key: "k0", label: "angle-0", phase: "Search", prompt: "p0", at: 3 },
      { type: "agent-queued", key: "k1", label: "angle-1", phase: "Search", prompt: "p1", at: 4 },
      { type: "agent-queued", key: "k2", label: "angle-2", phase: "Search", prompt: "p2", at: 5 },
    ];
    const { lastFrame, stdin } = render(<App events={multi} animate={false} />);
    await tick();
    stdin.write(KEY.down); // Search
    await tick();
    stdin.write(KEY.right); // focus agents
    await tick();
    stdin.write(KEY.down); // should select angle-1
    await tick();
    expect(lastFrame() ?? "").toMatch(/›\s*\S*\s*angle-1/);
    stdin.write(KEY.down); // angle-2
    await tick();
    expect(lastFrame() ?? "").toMatch(/›\s*\S*\s*angle-2/);
    stdin.write(KEY.up); // back to angle-1
    await tick();
    expect(lastFrame() ?? "").toMatch(/›\s*\S*\s*angle-1/);
  });

  it("up/down switch the selected agent while the detail pane is open", async () => {
    const multi: WorkflowEvent[] = [
      { type: "run-started", runId: "r1" as RunId, name: "wf", at: 0 },
      { type: "phase-started", phase: "Search", at: 1 },
      { type: "agent-queued", key: "k0", label: "angle-0", phase: "Search", prompt: "p0", at: 2 },
      { type: "agent-queued", key: "k1", label: "angle-1", phase: "Search", prompt: "p1", at: 3 },
    ];
    const { lastFrame, stdin } = render(<App events={multi} animate={false} />);
    await tick();
    stdin.write(KEY.right); // focus agents
    await tick();
    stdin.write(KEY.right); // focus detail (layout swaps to [Agents | Detail])
    await tick();
    const detail = lastFrame() ?? "";
    expect(detail).not.toContain("Phases"); // confirm we're in the detail view
    expect(detail).toContain("angle-0"); // detail header shows the selected agent
    stdin.write(KEY.down); // should switch selection to angle-1 without leaving detail
    await tick();
    const after = lastFrame() ?? "";
    expect(after).not.toContain("Phases"); // still in the detail view
    expect(after).toMatch(/›\s*\S*\s*angle-1/); // agents column selection moved
  });
});
