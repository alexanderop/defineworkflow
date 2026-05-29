import { describe, it, expect } from "vitest";
import { throttle, type ThrottleDeps } from "./throttle.js";

function fakeDeps() {
  let clock = 0;
  const timers: Array<{ id: number; fn: () => void; at: number }> = [];
  let nextId = 1;
  const deps: ThrottleDeps = {
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, fn, at: clock + ms });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const advance = (ms: number) => {
    clock += ms;
    for (const t of [...timers]) if (t.at <= clock) { timers.splice(timers.indexOf(t), 1); t.fn(); }
  };
  return { deps, advance, setClock: (n: number) => (clock = n) };
}

describe("throttle", () => {
  it("runs immediately on the leading edge", () => {
    const { deps } = fakeDeps();
    let calls = 0;
    const t = throttle(() => calls++, 100, deps);
    t.call();
    expect(calls).toBe(1);
  });

  it("coalesces rapid calls within the interval into a single trailing run", () => {
    const { deps, advance } = fakeDeps();
    let calls = 0;
    const t = throttle(() => calls++, 100, deps);
    t.call(); // leading → 1
    t.call();
    t.call(); // both within window → schedule one trailing
    expect(calls).toBe(1);
    advance(100); // trailing fires
    expect(calls).toBe(2);
  });

  it("allows a new leading run after the interval has fully elapsed", () => {
    const { deps, advance } = fakeDeps();
    let calls = 0;
    const t = throttle(() => calls++, 100, deps);
    t.call(); // 1
    advance(100);
    t.call(); // 2 (window elapsed → leading again)
    expect(calls).toBe(2);
  });
});
