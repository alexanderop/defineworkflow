import { describe, it, expect } from "vitest";
import type { WorkflowEvent } from "@workflow/core";
import { startUi } from "./render.js";

describe("startUi (non-TTY line-log)", () => {
  it("writes a line per meaningful event from initial + subscribed events", () => {
    const written: string[] = [];
    let listener: ((e: WorkflowEvent) => void) | undefined;

    const handle = startUi({
      isTTY: false,
      write: (t) => written.push(t),
      initial: [{ type: "run-started", runId: "r1", name: "demo", at: 0 }],
      subscribe: (l) => {
        listener = l;
        return () => {
          listener = undefined;
        };
      },
    });

    listener?.({ type: "phase-started", phase: "Search", at: 1 });
    listener?.({ type: "agent-queued", key: "k0", label: "a", phase: "Search", at: 2 }); // noisy → no line
    listener?.({ type: "run-finished", runId: "r1", at: 3 });

    expect(written).toEqual(["▶ demo (r1)\n", "# Search\n", "■ done\n"]);

    handle.unmount();
    listener?.({ type: "log", message: "after unmount", at: 4 }); // unsubscribed → ignored
    expect(written).toEqual(["▶ demo (r1)\n", "# Search\n", "■ done\n"]);
  });
});
