#!/usr/bin/env node
/**
 * Refresh the MODEL_PRICES table in packages/core/src/pricing.ts from OpenRouter.
 *
 * Usage:
 *   node update-pricing.mjs            # dry-run: print the diff, write nothing
 *   node update-pricing.mjs --write    # rewrite only the <pricing-table:*> block
 *   node update-pricing.mjs --file <path-to-pricing.ts>
 *
 * Pure mechanics: fetch → filter anthropic/ → USD/token → USD/Mtok → carry over existing aliases →
 * diff → (optionally) rewrite. It never touches USD_TO_EUR or anything outside the markers.
 */
import { readFile, writeFile } from "node:fs/promises";

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const START = "// <pricing-table:start>";
const END = "// <pricing-table:end>";

function parseArgs(argv) {
  const args = { write: false, file: "packages/core/src/pricing.ts" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--write") args.write = true;
    else if (argv[i] === "--file") args.file = argv[++i];
  }
  return args;
}

/** Round away floating-point noise (parseFloat × 1e6 yields e.g. 0.7999999999999999). */
const round = (n) => Math.round(n * 1e6) / 1e6;

/** Pull the existing entries (id → aliases) out of the current marker block. */
function parseExisting(source) {
  const block = source.slice(source.indexOf(START), source.indexOf(END));
  const byId = new Map();
  const re = /id:\s*"([^"]+)"[^}]*?aliases:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const aliases = m[2]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    byId.set(m[1], aliases);
  }
  return byId;
}

function formatEntry(e) {
  const aliases = e.aliases.map((a) => `"${a}"`).join(", ");
  return `  { id: "${e.id}", aliases: [${aliases}], inputPerMTokUsd: ${e.inputPerMTokUsd}, outputPerMTokUsd: ${e.outputPerMTokUsd} },`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const res = await fetch(MODELS_URL);
  if (!res.ok) throw new Error(`OpenRouter responded ${res.status} ${res.statusText}`);
  const { data } = await res.json();

  const fresh = data
    .filter((m) => typeof m.id === "string" && m.id.startsWith("anthropic/"))
    .map((m) => ({
      id: m.id,
      inputPerMTokUsd: round(parseFloat(m.pricing.prompt) * 1e6),
      outputPerMTokUsd: round(parseFloat(m.pricing.completion) * 1e6),
    }))
    .toSorted((a, b) => a.id.localeCompare(b.id));

  const source = await readFile(args.file, "utf8");
  const existing = parseExisting(source);

  // Carry over hand-curated aliases; brand-new models get an empty list to fill in.
  const entries = fresh.map((e) => ({ ...e, aliases: existing.get(e.id) ?? [] }));

  // ---- Diff report -------------------------------------------------------
  const freshIds = new Set(fresh.map((e) => e.id));
  const oldPrices = new Map();
  {
    const block = source.slice(source.indexOf(START), source.indexOf(END));
    const re = /id:\s*"([^"]+)"[^}]*?inputPerMTokUsd:\s*([\d.]+),\s*outputPerMTokUsd:\s*([\d.]+)/g;
    let m;
    while ((m = re.exec(block)) !== null) oldPrices.set(m[1], { in: +m[2], out: +m[3] });
  }

  console.log("OpenRouter Anthropic models:", fresh.length, "\n");
  for (const e of entries) {
    const prev = oldPrices.get(e.id);
    if (!prev) {
      console.log(`  + NEW   ${e.id}  in $${e.inputPerMTokUsd}/Mtok  out $${e.outputPerMTokUsd}/Mtok  (aliases: [] — fill in)`);
    } else if (prev.in !== e.inputPerMTokUsd || prev.out !== e.outputPerMTokUsd) {
      console.log(`  ~ PRICE ${e.id}  in $${prev.in}→$${e.inputPerMTokUsd}  out $${prev.out}→$${e.outputPerMTokUsd}`);
    }
  }
  for (const id of oldPrices.keys()) {
    if (!freshIds.has(id)) console.log(`  ! GONE  ${id}  — OpenRouter no longer lists this; review before removing`);
  }

  const newBlock = `${START} generated from openrouter.ai/api/v1/models — edit via the update-pricing skill\nexport const MODEL_PRICES: readonly ModelPrice[] = [\n${entries.map(formatEntry).join("\n")}\n];\n${END}`;

  if (!args.write) {
    console.log("\nDry run — no file written. Re-run with --write to apply.");
    console.log("Reminder: USD_TO_EUR is manual and is NOT refreshed by this skill.");
    return;
  }

  const before = source.indexOf(START);
  const endAt = source.indexOf(END);
  if (before === -1 || endAt === -1) throw new Error("Could not find <pricing-table:*> markers in " + args.file);
  const updated = source.slice(0, before) + newBlock + source.slice(endAt + END.length);
  await writeFile(args.file, updated);
  console.log("\nWrote", args.file);
  console.log("Reminder: USD_TO_EUR is manual and is NOT refreshed by this skill.");
}

main().catch((err) => {
  console.error("update-pricing failed:", err.message);
  process.exit(1);
});
