/** `H` is the injected timer's handle type, inferred from `setTimer` so the call site keeps it
 * concrete (e.g. `ReturnType<typeof setTimeout>`) instead of erasing it to `unknown`. */
export interface ThrottleDeps<H> {
  readonly now: () => number;
  readonly setTimer: (fn: () => void, ms: number) => H;
  readonly clearTimer: (handle: H) => void;
}

export interface Throttled {
  call(): void;
  cancel(): void;
}

/** Leading-edge throttle with a single trailing call; ~10fps when ms = 100. */
export function throttle<H>(fn: () => void, ms: number, deps: ThrottleDeps<H>): Throttled {
  let last = -Infinity;
  let timer: H | undefined = undefined;

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
