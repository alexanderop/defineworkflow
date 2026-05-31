import { describe, it, expect } from "vitest";
import type { RunId } from "@workflow/core";
import type { WorkflowEvent } from "@workflow/core";
import { subscribeToRun, type TailDeps } from "./tail.js";

function fakeTail(store: WorkflowEvent[]) {
  let onChange: (() => void) | null = null;
  let unwatched = false;
  const deps: TailDeps = {
    readEvents: () => [...store],
    watch: (cb) => {
      onChange = cb;
      return () => {
        unwatched = true;
        onChange = null;
      };
    },
  };
  return { deps, fire: () => onChange?.(), isUnwatched: () => unwatched };
}

describe("subscribeToRun", () => {
  it("snapshots initial events and delivers only newly-appended ones", () => {
    const store: WorkflowEvent[] = [
      { type: "run-started", runId: "r" as RunId, name: "demo", at: 0 },
    ];
    const { deps, fire } = fakeTail(store);
    const { initial, subscribe } = subscribeToRun(deps);
    expect(initial).toHaveLength(1);

    const seen: WorkflowEvent[] = [];
    subscribe((e) => seen.push(e));

    store.push({ type: "phase-started", phase: "Search", at: 1 });
    fire();
    store.push({ type: "log", message: "hi", at: 2 });
    fire();

    expect(seen.map((e) => e.type)).toEqual(["phase-started", "log"]);
  });

  it("does not re-deliver events already seen", () => {
    const store: WorkflowEvent[] = [];
    const { deps, fire } = fakeTail(store);
    const { subscribe } = subscribeToRun(deps);
    const seen: WorkflowEvent[] = [];
    subscribe((e) => seen.push(e));

    store.push({ type: "log", message: "a", at: 1 });
    fire();
    fire(); // no new events
    expect(seen).toHaveLength(1);
  });

  it("stops watching after run-finished", () => {
    const store: WorkflowEvent[] = [];
    const { deps, fire, isUnwatched } = fakeTail(store);
    const { subscribe } = subscribeToRun(deps);
    const seen: WorkflowEvent[] = [];
    subscribe((e) => seen.push(e));

    store.push({ type: "run-finished", runId: "r" as RunId, at: 1 });
    fire();
    expect(isUnwatched()).toBe(true);

    store.push({ type: "log", message: "after", at: 2 });
    fire();
    expect(seen.map((e) => e.type)).toEqual(["run-finished"]);
  });
});
