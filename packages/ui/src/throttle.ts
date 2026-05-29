export interface ThrottleDeps {
  readonly now: () => number;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

export interface Throttled {
  call(): void;
  cancel(): void;
}

/** Leading-edge throttle with a single trailing call; ~10fps when ms = 100. */
export function throttle(fn: () => void, ms: number, deps: ThrottleDeps): Throttled {
  let last = -Infinity;
  let timer: unknown = undefined;

  const invoke = (): void => {
    last = deps.now();
    timer = undefined;
    fn();
  };

  return {
    call() {
      const elapsed = deps.now() - last;
      if (elapsed >= ms) {
        invoke();
        return;
      }
      if (timer === undefined) timer = deps.setTimer(invoke, ms - elapsed);
    },
    cancel() {
      if (timer !== undefined) {
        deps.clearTimer(timer);
        timer = undefined;
      }
    },
  };
}
