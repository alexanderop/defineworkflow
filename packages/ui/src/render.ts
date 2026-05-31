import { render } from "ink";
import { createElement } from "react";
import { initialRunState, reduce, selectRunReport, type WorkflowEvent } from "@workflow/core";
import { App, type UiAction } from "./App.js";
import { RunReport } from "./RunReport.js";
import { createLineLogger } from "./line-log.js";
import { throttle } from "./throttle.js";

export interface StartUiOptions {
  readonly subscribe: (listener: (event: WorkflowEvent) => void) => () => void;
  readonly initial?: readonly WorkflowEvent[];
  readonly adapter?: string | undefined;
  readonly onAction?: ((action: UiAction) => void) | undefined;
  readonly isTTY?: boolean;
  readonly write?: (text: string) => void;
}

export interface UiHandle {
  unmount(): void;
}

export function startUi(opts: StartUiOptions): UiHandle {
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);
  const initial = opts.initial ?? [];

  if (!isTTY) {
    const write = opts.write ?? ((t: string) => void process.stdout.write(t));
    const lineLog = createLineLogger();
    const emitLine = (e: WorkflowEvent): void => {
      const line = lineLog(e);
      if (line !== null) write(line + "\n");
    };
    for (const e of initial) emitLine(e);
    const unsub = opts.subscribe(emitLine);
    return { unmount: unsub };
  }

  const events: WorkflowEvent[] = [...initial];

  // Watching a run that has already finished: there is nothing live to stream, so render a
  // static end-of-run report instead of the three-pane App.
  const initialState = events.reduce(reduce, initialRunState());
  if (initialState.status === "finished") {
    const instance = render(createElement(RunReport, { report: selectRunReport(initialState) }));
    return { unmount: () => instance.unmount() };
  }

  const instance = render(createElement(App, { events, adapter: opts.adapter, onAction: opts.onAction }));
  const rerenderNow = (): void => {
    instance.rerender(createElement(App, { events: [...events], adapter: opts.adapter, onAction: opts.onAction }));
  };
  const throttled = throttle(rerenderNow, 100, {
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h),
  });
  const unsub = opts.subscribe((e) => {
    // Append in place (O(1)); rerenderNow snapshots a fresh array for React.
    events.push(e);
    throttled.call();
  });
  return {
    unmount: () => {
      rerenderNow();
      throttled.cancel();
      unsub();
      instance.unmount();
    },
  };
}
