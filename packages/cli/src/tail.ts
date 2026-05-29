import type { WorkflowEvent } from "@workflow/core";

export interface TailDeps {
  /** Current full contents of the run's event log. */
  readonly readEvents: () => readonly WorkflowEvent[];
  /** Register a change listener (e.g. fs.watch); returns an unsubscribe. */
  readonly watch: (onChange: () => void) => () => void;
}

export interface RunSubscription {
  readonly initial: readonly WorkflowEvent[];
  readonly subscribe: (listener: (event: WorkflowEvent) => void) => () => void;
}

/**
 * Adapt a growing `events.jsonl` into the `{ initial, subscribe }` shape `startUi`
 * expects: snapshot what's already there, then deliver each newly-appended event exactly
 * once. Watching stops after `run-finished` so a watched run terminates cleanly.
 */
export function subscribeToRun(deps: TailDeps): RunSubscription {
  const initial = deps.readEvents();
  let delivered = initial.length;

  return {
    initial,
    subscribe(listener) {
      let stopped = false;
      let unwatch: () => void = () => {};
      const onChange = (): void => {
        if (stopped) return;
        const all = deps.readEvents();
        for (let i = delivered; i < all.length; i++) {
          const event = all[i];
          if (!event) continue;
          listener(event);
          if (event.type === "run-finished") stopped = true;
        }
        delivered = all.length;
        if (stopped) unwatch();
      };
      unwatch = deps.watch(onChange);
      return () => {
        stopped = true;
        unwatch();
      };
    },
  };
}
