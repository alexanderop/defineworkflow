import { assertNever, type AgentStatus } from "@workflow/core";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function spinnerFrame(frame: number): string {
  return SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  const rounded = k >= 100 ? Math.round(k) : Math.round(k * 10) / 10;
  return `${rounded}k`;
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** Compact duration as in the mockups: `Ns` under a minute, `m:ss` at or above one. */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const MODEL_TIERS: Readonly<Record<string, string>> = {
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};

/**
 * Friendly model name: `claude-opus-4-8[1m]` → `Opus 4.8 (1M context)`.
 * Unknown ids fall back to the raw string so nothing is ever hidden.
 */
export function formatModel(id: string): string {
  if (id === "") return "";
  const ctxMatch = /\[(\d+)m\]$/i.exec(id);
  const base = ctxMatch ? id.slice(0, ctxMatch.index) : id;
  const ctxNote = ctxMatch ? ` (${ctxMatch[1]!.toUpperCase()}M context)` : "";
  const m = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)$/.exec(base);
  if (!m) return id;
  return `${MODEL_TIERS[m[1]!]} ${m[2]}.${m[3]}${ctxNote}`;
}

export function statusGlyph(status: AgentStatus, frame = 0): string {
  switch (status) {
    case "done":
      return "✓";
    case "failed":
      return "✗";
    case "queued":
      return "▱";
    case "running":
      return spinnerFrame(frame);
    default:
      return assertNever(status);
  }
}
