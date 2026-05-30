import { render } from "ink";
import { createElement } from "react";
import type { WorkflowEvent } from "@workflow/core";
import { App, type UiAction } from "./App.js";
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
  const instance = render(createElement(App, { events, adapter: opts.adapter, onAction: opts.onAction }));
  const rerenderNow = (): void => {
    instance.rerender(createElement(App, { events: [...events], adapter: opts.adapter, onAction: opts.onAction }));
  };
  const throttled = throttle(rerenderNow, 100, {
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
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
