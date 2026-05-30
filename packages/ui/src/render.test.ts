import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import type { WorkflowEvent } from "@workflow/core";
import { startUi } from "./render.js";

const inkMock = vi.hoisted(() => {
  const frames: ReactElement[] = [];
  return {
    frames,
    render: vi.fn((element: ReactElement) => {
      frames.push(element);
      return {
        rerender: (next: ReactElement) => frames.push(next),
        unmount: vi.fn(),
      };
    }),
  };
});

vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ink")>();
  return { ...actual, render: inkMock.render };
});

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

describe("startUi (TTY)", () => {
  it("flushes pending events into the final frame before unmounting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    inkMock.frames.length = 0;
    inkMock.render.mockClear();

    let listener: ((e: WorkflowEvent) => void) | undefined;
    const handle = startUi({
      isTTY: true,
      initial: [
        { type: "run-started", runId: "r1", name: "haiku", at: 0 },
        { type: "phase-started", phase: "Write", at: 1 },
        { type: "agent-queued", key: "k0", label: "haiku-writer", phase: "Write", at: 2 },
        { type: "agent-started", key: "k0", at: 3 },
      ],
      subscribe: (l) => {
        listener = l;
        return () => {
          listener = undefined;
        };
      },
    });

    listener?.({ type: "agent-output", key: "k0", chunk: "draft", at: 4 });
    listener?.({
      type: "agent-finished",
      key: "k0",
      usage: { inputTokens: 1, outputTokens: 1 },
      cached: false,
      at: 5,
    });
    handle.unmount();

    const finalEvents = inkMock.frames.at(-1)?.props.events as readonly WorkflowEvent[];
    expect(finalEvents.at(-1)?.type).toBe("agent-finished");

    vi.useRealTimers();
  });
});
