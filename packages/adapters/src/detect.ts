import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { HarnessId } from "@workflow/core";

/** Alias of the canonical `HarnessId` (declared once in `@workflow/core`) so the two unions can't
 * drift; keeping the `AdapterId` name leaves the CLI call sites and `CAPABILITIES` keys untouched. */
export type AdapterId = HarnessId;

export interface Capabilities {
  readonly nativeSchema: boolean;
  readonly reportsTokens: boolean;
  readonly toolEvents: boolean;
}

export const CAPABILITIES: Readonly<Record<AdapterId, Capabilities>> = {
  // All three CLIs stream tool events; codex/copilot now report real usage from
  // their turn/result events (replacing the old approximate length estimate).
  claude: { nativeSchema: true, reportsTokens: true, toolEvents: true },
  codex: { nativeSchema: true, reportsTokens: true, toolEvents: true },
  copilot: { nativeSchema: false, reportsTokens: true, toolEvents: true },
  "raw-api": { nativeSchema: true, reportsTokens: true, toolEvents: false },
};

type CliAdapterId = Exclude<AdapterId, "raw-api">;
const CLI_BINS: Readonly<Record<CliAdapterId, string>> = { claude: "claude", codex: "codex", copilot: "copilot" };
const CLI_ADAPTER_IDS: readonly CliAdapterId[] = ["claude", "codex", "copilot"];

async function binExists(bin: string): Promise<boolean> {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    try {
      await access(join(dir, bin), constants.X_OK);
      return true;
    } catch {
      // not here; keep looking
    }
  }
  return false;
}

export interface DetectDeps {
  readonly exists?: (bin: string) => Promise<boolean>;
}

/** Returns the CLI adapter ids whose binary is on PATH. `raw-api` is always available (no binary). */
export async function detectAdapters(deps: DetectDeps = {}): Promise<readonly AdapterId[]> {
  const exists = deps.exists ?? binExists;
  const found: AdapterId[] = [];
  for (const id of CLI_ADAPTER_IDS) {
    if (await exists(CLI_BINS[id])) found.push(id);
  }
  return found;
}
