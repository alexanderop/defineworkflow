import type { AgentProgress } from "@workflow/core";

/** Terminal extraction from a harness stream, read after the process closes. */
export interface TranslatorResult {
  readonly text: string;
  /** Structured data the stream carried natively (e.g. claude `structured_output`); else undefined. */
  readonly data?: unknown;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  /** Whether the harness signalled an error in its final event. */
  readonly isError?: boolean;
  readonly errorMessage?: string;
}

/**
 * Maps one harness's native NDJSON event stream into the shared progress contract.
 * `push` is fed each stdout line as it arrives and returns zero or more progress
 * updates to forward; `result` extracts the terminal text/data/usage after close.
 */
export interface StreamTranslator {
  push(line: string): readonly AgentProgress[];
  result(): TranslatorResult;
}

/** Parse a single NDJSON line into an object, or null for blank/non-JSON noise. */
export function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (trimmed === "" || (trimmed[0] !== "{" && trimmed[0] !== "[")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
