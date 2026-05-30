/** Max length of model output stored on a SchemaValidation error — it is journaled/persisted with the run. */
export const MAX_RAW_OUTPUT = 1000;

/** Bound the raw model output stored on an error so a verbose prose answer can't bloat the run record. */
export function truncateRawOutput(text: string): string {
  if (text.length <= MAX_RAW_OUTPUT) return text;
  return `${text.slice(0, MAX_RAW_OUTPUT)}… [truncated ${text.length - MAX_RAW_OUTPUT} chars]`;
}
