import type { RunReport } from "./report.js";
import type { Immutable } from "./type-ext.js";

/**
 * One priced model. Prices are USD per **million** tokens (OpenRouter reports USD per token; the
 * `update-pricing` skill multiplies by 1e6 when seeding this table).
 */
interface ModelPriceShape {
  /** OpenRouter canonical id, e.g. "anthropic/claude-opus-4.8". */
  id: string;
  /** Raw harness model ids that map to this entry, e.g. "claude-opus-4-8". */
  aliases: string[];
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
}
export type ModelPrice = Immutable<ModelPriceShape>;

/**
 * USD → EUR conversion rate. Update manually; OpenRouter does not provide FX rates, so the
 * `update-pricing` skill leaves this line untouched.
 */
export const USD_TO_EUR = 0.92;

// <pricing-table:start> generated from openrouter.ai/api/v1/models — edit via the update-pricing skill
export const MODEL_PRICES: readonly ModelPrice[] = [
  { id: "anthropic/claude-3-haiku", aliases: ["claude-3-haiku"], inputPerMTokUsd: 0.25, outputPerMTokUsd: 1.25 },
  { id: "anthropic/claude-3.5-haiku", aliases: ["claude-3-5-haiku"], inputPerMTokUsd: 0.8, outputPerMTokUsd: 4 },
  { id: "anthropic/claude-haiku-4.5", aliases: ["claude-haiku-4-5"], inputPerMTokUsd: 1, outputPerMTokUsd: 5 },
  { id: "anthropic/claude-opus-4", aliases: ["claude-opus-4"], inputPerMTokUsd: 15, outputPerMTokUsd: 75 },
  { id: "anthropic/claude-opus-4.1", aliases: ["claude-opus-4-1"], inputPerMTokUsd: 15, outputPerMTokUsd: 75 },
  { id: "anthropic/claude-opus-4.5", aliases: ["claude-opus-4-5"], inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  { id: "anthropic/claude-opus-4.6", aliases: ["claude-opus-4-6"], inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  { id: "anthropic/claude-opus-4.6-fast", aliases: ["claude-opus-4-6-fast"], inputPerMTokUsd: 30, outputPerMTokUsd: 150 },
  { id: "anthropic/claude-opus-4.7", aliases: ["claude-opus-4-7"], inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  { id: "anthropic/claude-opus-4.7-fast", aliases: ["claude-opus-4-7-fast"], inputPerMTokUsd: 30, outputPerMTokUsd: 150 },
  { id: "anthropic/claude-opus-4.8", aliases: ["claude-opus-4-8"], inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  { id: "anthropic/claude-opus-4.8-fast", aliases: ["claude-opus-4-8-fast"], inputPerMTokUsd: 10, outputPerMTokUsd: 50 },
  { id: "anthropic/claude-sonnet-4", aliases: ["claude-sonnet-4"], inputPerMTokUsd: 3, outputPerMTokUsd: 15 },
  { id: "anthropic/claude-sonnet-4.5", aliases: ["claude-sonnet-4-5"], inputPerMTokUsd: 3, outputPerMTokUsd: 15 },
  { id: "anthropic/claude-sonnet-4.6", aliases: ["claude-sonnet-4-6"], inputPerMTokUsd: 3, outputPerMTokUsd: 15 },
];
// <pricing-table:end>

/**
 * Canonicalize a model id from either side (harness-recorded or OpenRouter) into a single
 * comparable form, so e.g. `claude-opus-4-8[1m]` and `anthropic/claude-opus-4.8` compare equal.
 */
function normalize(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, "") // strip a trailing bracket tag, e.g. the [1m] context marker
    .replace(/^anthropic\//, "") // strip the OpenRouter vendor prefix
    .replace(/-\d{8}$/, "") // strip a trailing date stamp, e.g. -20251001
    .replace(/-(\d+)-(\d+)/g, "-$1.$2"); // unify version separators: 4-8 → 4.8
}

/** Resolve a model id to its price entry, or `undefined` when the table doesn't list it. */
export function findPrice(modelId: string): ModelPrice | undefined {
  const target = normalize(modelId);
  return MODEL_PRICES.find(
    (p) => normalize(p.id) === target || p.aliases.some((alias) => normalize(alias) === target),
  );
}

interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Per-call USD cost. `undefined` when the model isn't in the table — never a silent €0. */
export function costUsd(modelId: string, usage: Usage): number | undefined {
  const price = findPrice(modelId);
  if (price === undefined) return undefined;
  return (usage.inputTokens / 1e6) * price.inputPerMTokUsd + (usage.outputTokens / 1e6) * price.outputPerMTokUsd;
}

/** Per-call EUR cost = `costUsd × USD_TO_EUR`. `undefined` when the model isn't priced. */
export function costEur(modelId: string, usage: Usage): number | undefined {
  const usd = costUsd(modelId, usage);
  return usd === undefined ? undefined : usd * USD_TO_EUR;
}

/** A model id placeholder used in `runCostEur().unpriced` for agents with no recorded model. */
const UNKNOWN_MODEL = "<unknown>";

/**
 * Run-level EUR rollup. Sums non-cached agents' costs and lists the distinct model ids it could
 * not price (rather than under-counting silently). Cached (journal-replayed) agents are excluded,
 * matching how `report.ts` excludes them from token totals.
 */
export function runCostEur(report: RunReport): { eur: number; unpriced: readonly string[] } {
  let eur = 0;
  const unpriced = new Set<string>();
  for (const a of report.agents) {
    if (a.status === "cached") continue;
    const cost = a.model === undefined ? undefined : costEur(a.model, a);
    if (cost === undefined) {
      unpriced.add(a.model ?? UNKNOWN_MODEL);
    } else {
      eur += cost;
    }
  }
  return { eur, unpriced: [...unpriced] };
}
