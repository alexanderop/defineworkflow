/**
 * A reusable bundle of agent execution defaults. Created with {@link profile} and applied at
 * an `agent()` call site (`agent(reviewer, prompt, opts)`). Profiles are pure, static config —
 * resolving one is a deterministic merge before the existing agent request is built, so the
 * sequence number, journal key, semaphore behavior, schema validation, and event stream are
 * unchanged.
 */
export interface ProfileConfig {
  readonly adapter?: string;
  readonly model?: string;
  readonly agentType?: string;
  readonly isolation?: "worktree";
  /** A persona / system hint prepended to the prompt of every call that uses this profile. */
  readonly instructions?: string;
}

/**
 * Structural string brand (not a symbol) so the type is shareable across packages without a
 * value import — the published `defineworkflow` package re-declares an identical `Profile` and
 * its own pure `profile()` rather than bundling `@workflow/core`. Keep this key in sync there.
 */
export interface Profile {
  readonly __workflowProfile: true;
  readonly config: ProfileConfig;
}

/** Bundle reusable agent defaults into a {@link Profile}. Pure: freezes a copy of `config`. */
export function profile(config: ProfileConfig): Profile {
  return {
    __workflowProfile: true,
    config: Object.freeze({ ...config }),
  };
}

/** Type guard: is `value` a {@link Profile} produced by {@link profile}? */
export function isProfile(value: unknown): value is Profile {
  if (typeof value !== "object" || value === null) return false;
  const candidate: Partial<Profile> = value;
  return candidate.__workflowProfile === true;
}
