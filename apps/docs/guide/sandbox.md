# The sandbox

<p class="wf-eyebrow">packages/core/src/sandbox.ts</p>

Scripts run in a Node `vm` context. Replay only works if a re-run produces the *identical* sequence of
calls — so the three sources of nondeterminism are **hard-banned**. Click each snippet to run it
against the sandbox and see what happens.

<SandboxWidget />

<RoughDiagram
  direction="LR"
  caption="the boundary: primitives are injected as globals, the clock and RNG are walled off — so every run replays identically"
  :nodes="[
    { id: 'script', label: 'script.ts', sub: 'your body' },
    { id: 'agent', label: 'agent()', accent: 'amber' },
    { id: 'parallel', label: 'parallel()', accent: 'amber' },
    { id: 'argsbudget', label: 'args / budget', accent: 'amber' },
    { id: 'now', label: 'Date.now()', accent: 'red' },
    { id: 'rand', label: 'Math.random()', accent: 'red' },
    { id: 'date', label: 'new Date()', sub: 'argless', accent: 'red' },
    { id: 'replay', label: 'replay', sub: 'journal resume', accent: 'cyan' },
  ]"
  :edges="[
    { from: 'agent', to: 'script', label: 'injected' },
    { from: 'parallel', to: 'script' },
    { from: 'argsbudget', to: 'script' },
    { from: 'now', to: 'script', label: 'banned', dashed: true },
    { from: 'rand', to: 'script', dashed: true },
    { from: 'date', to: 'script', dashed: true },
    { from: 'script', to: 'replay', label: 'deterministic' },
  ]"
/>

## What's banned, and why

| Banned | Why it breaks replay |
|---|---|
| `Date.now()` | Wall-clock changes every run, so any branch on it diverges. |
| `Math.random()` | Randomness ⇒ different seq order on replay ⇒ journal misalignment. |
| `new Date()` *(argless)* | Reads the clock. `new Date("2026-05-30")` is fine — it's explicit. |

```js
function makeBannedDate() {
  const Banned = function (...args) {
    if (args.length === 0)
      throw new Error("SandboxViolation: argless new Date() is not allowed");
    return new RealDate(...args);
  };
  Banned.now = () => { throw new Error("SandboxViolation: Date.now() is not allowed"); };
  return Banned;
}
```

## Need time or randomness?

Pass it in deterministically:

- **Time / seeds** → through `args`. The same input replays identically.
- **Variation across items** → derive it from the item index (`idx % n`), not a random source.

## How the script is loaded

`transformScript()` rewrites `export const meta = …` into a plain `const`, then wraps the body in an
async IIFE — which is why top-level `await` and `return` work in your script.

`extractMeta()` reuses the same sandbox with **sentinel-throwing stubs** for `agent()`/`parallel()`/…
It runs the script just far enough to capture `meta` (assigned synchronously at the top), then aborts
at the first primitive call. That's how the CLI's consent gate can show you the run's name and phases
*before* committing to a real run.
