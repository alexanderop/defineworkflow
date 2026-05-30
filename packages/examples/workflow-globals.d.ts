// Ambient declarations for the globals the workflow runtime injects into every
// `*.workflow.ts` sandbox. These are NOT imported — the runtime provides them at
// execution time (see packages/core/src/runtime.ts → Runtime). This file exists
// purely so editors and `tsc` understand the examples.
import type { z as Zod } from "zod";

declare global {
  /** The zod instance injected by the runtime — build schemas to pass as `agent(..., { schema })`. */
  const z: typeof Zod;
  /** Expose zod's type-level helpers (`z.infer`, `z.ZodType`, …) in type position too. */
  namespace z {
    type infer<T extends Zod.ZodType> = Zod.infer<T>;
    type input<T extends Zod.ZodType> = Zod.input<T>;
    type output<T extends Zod.ZodType> = Zod.output<T>;
    type ZodType = Zod.ZodType;
  }

  interface AgentOptions {
    readonly label?: string;
    readonly phase?: string;
    readonly schema?: Zod.ZodType;
    readonly model?: string;
    readonly agentType?: string;
    readonly adapter?: string;
    readonly isolation?: "worktree";
  }

  interface Budget {
    readonly total: number | null;
    spent(): number;
    remaining(): number;
  }

  /** Spawn a subagent. Without `schema` returns the final text; with `schema` returns the validated object. */
  function agent(prompt: string, opts?: AgentOptions): Promise<unknown>;
  /** Run thunks concurrently (barrier). A thunk that throws resolves to `null`. */
  function parallel<T>(thunks: ReadonlyArray<() => Promise<T>>): Promise<Array<T | null>>;
  /** Run each item through all stages independently — no barrier between stages. */
  function pipeline(
    items: readonly unknown[],
    ...stages: ReadonlyArray<(prev: unknown, item: unknown, index: number) => Promise<unknown>>
  ): Promise<Array<unknown | null>>;
  /** Start a new phase; later `agent()` calls group under this title in the UI. */
  function phase(title: string): void;
  /** Emit a progress line to the user. */
  function log(message: string): void;
  /** Run another saved/bundled workflow inline and return its result. */
  function workflow(name: string, args?: unknown): Promise<unknown>;
  /** The value passed via `--args '{...}'`, verbatim (null if none). */
  const args: unknown;
  /** Token budget for this run. `total` is null when no budget was set. */
  const budget: Budget;
}

export {};
