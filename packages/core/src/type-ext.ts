/**
 * The repo's blessed type-utility vocabulary, routed through a single module so every other
 * package imports immutability / branding / ergonomics helpers from `@workflow/core` rather than
 * depending on `type-fest` directly. This file is a **leaf re-export** — it imports only from
 * `type-fest` (never a sibling core module), so it never forms a dependency cycle and `core` keeps
 * emitting declarations before its dependents.
 */
import type {
  ReadonlyDeep,
  WritableDeep,
  Tagged,
  UnwrapTagged,
  JsonValue,
  JsonObject,
  Simplify,
  Merge,
} from "type-fest";

/** Deeply immutable view of T. The blessed way to type state & ingress data. */
export type Immutable<T> = ReadonlyDeep<T>;
/** Deeply mutable inverse — only for build-then-freeze locals. */
export type Mutable<T> = WritableDeep<T>;

export type { Tagged, UnwrapTagged, JsonValue, JsonObject, Simplify, Merge };
