import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Match a `model = "..."` / `model = '...'` assignment, capturing the value. */
const MODEL_LINE = /^\s*model\s*=\s*["']([^"']+)["']/;
/** Match a TOML table header like `[profiles.fast]`, capturing the dotted path. */
const TABLE_HEADER = /^\s*\[([^\]]+)\]\s*$/;

/**
 * Best-effort read of codex's configured `model` from a `config.toml` body.
 * Reads the top-level `model`, and — when `profile` is given — prefers the
 * `[profiles.<profile>]` table's `model`, falling back to the top-level value.
 * This is a deliberately tiny TOML subset (the only key we need) so we add no
 * TOML dependency; anything it can't parse simply yields `undefined`.
 */
export function parseCodexModel(toml: string, profile?: string): string | undefined {
  let topLevel: string | undefined;
  let profileModel: string | undefined;
  let currentTable = ""; // "" = the root table
  const wantTable = profile !== undefined ? `profiles.${profile}` : undefined;

  for (const line of toml.split("\n")) {
    const header = TABLE_HEADER.exec(line);
    if (header?.[1] !== undefined) {
      currentTable = header[1].trim();
      continue;
    }
    const m = MODEL_LINE.exec(line);
    if (m?.[1] === undefined) continue;
    if (currentTable === "") topLevel = m[1];
    else if (wantTable !== undefined && currentTable === wantTable) profileModel = m[1];
  }

  return profileModel ?? topLevel;
}

/**
 * Best-effort read of `~/.codex/config.toml`'s `model`. Never throws — a missing
 * or unreadable file yields `undefined` (we then leave the model display blank
 * rather than guessing codex's built-in default).
 */
export function readCodexModel(profile?: string): string | undefined {
  try {
    const body = readFileSync(join(homedir(), ".codex", "config.toml"), "utf8");
    return parseCodexModel(body, profile);
  } catch {
    return undefined;
  }
}
