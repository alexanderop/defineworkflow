import type { Tagged } from "./type-ext.js";

/** A workflow run's unique id — minted by `genRunId`, used as its on-disk directory key. */
export type RunId = Tagged<string, "RunId">;

/**
 * An agent's composite identity, `` `${seq}:${phase}:${label}` `` — minted once per `agent()`
 * in the runtime and handed to the control registry / worktree factory. Distinct from the bare
 * `phase`/`label` strings it's built from, so they can't be passed where the full key is wanted.
 */
export type AgentKey = Tagged<string, "AgentKey">;
