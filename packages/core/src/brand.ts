/**
 * Nominal ("branded") type: a base type `T` tagged with a compile-time-only marker `B`,
 * so two brands over the same base (e.g. `RunId` and `AgentKey`, both strings) are mutually
 * unassignable and a bare `T` is not assignable to either without an explicit cast.
 *
 * The `__brand` field is phantom — it never exists at runtime. Mint a branded value with a
 * single `as` cast at a trusted boundary (a constructor/validator); everywhere else it flows
 * as the real `T` and widens back to `T` for free (template literals, comparisons, map keys).
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** A workflow run's unique id — minted by `genRunId`, used as its on-disk directory key. */
export type RunId = Brand<string, "RunId">;

/**
 * An agent's composite identity, `` `${seq}:${phase}:${label}` `` — minted once per `agent()`
 * in the runtime and handed to the control registry / worktree factory. Distinct from the bare
 * `phase`/`label` strings it's built from, so they can't be passed where the full key is wanted.
 */
export type AgentKey = Brand<string, "AgentKey">;
