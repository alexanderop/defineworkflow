import { describe, expect, it } from "vitest";

import type { RunId } from "./brand.js";
import type { AgentReport, RunReport } from "./report.js";
import { USD_TO_EUR, costEur, costUsd, findPrice, runCostEur } from "./pricing.js";

// oxlint-disable-next-line typescript/consistent-type-assertions -- minting a branded nominal type for a test
const runId = "r1" as RunId;

const agent = (o: Partial<AgentReport> = {}): AgentReport => ({
  label: "a",
  phase: "Work",
  status: "done",
  inputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
  ...o,
});

const report = (agents: readonly AgentReport[]): RunReport => ({
  runId,
  name: "wf",
  status: "finished",
  totals: {
    agents: agents.length,
    cached: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
    approximate: false,
  },
  phases: [],
  agents,
});

describe("findPrice", () => {
  it("resolves the raw harness id", () => {
    expect(findPrice("claude-opus-4-8")?.id).toBe("anthropic/claude-opus-4.8");
  });

  it("strips a trailing bracket context tag", () => {
    expect(findPrice("claude-opus-4-8[1m]")?.id).toBe("anthropic/claude-opus-4.8");
  });

  it("resolves the OpenRouter canonical id", () => {
    expect(findPrice("anthropic/claude-opus-4.8")?.id).toBe("anthropic/claude-opus-4.8");
  });

  it("strips a trailing date stamp", () => {
    expect(findPrice("claude-haiku-4-5-20251001")?.id).toBe("anthropic/claude-haiku-4.5");
  });

  it("returns undefined for an unknown model", () => {
    expect(findPrice("gpt-5")).toBeUndefined();
  });
});

describe("costUsd / costEur", () => {
  it("computes USD from per-Mtok rates", () => {
    // opus-4.8: $5/Mtok in, $25/Mtok out
    const usd = costUsd("claude-opus-4-8", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(usd).toBe(30);
  });

  it("computes EUR as USD × USD_TO_EUR", () => {
    const usage = { inputTokens: 2_000_000, outputTokens: 0 };
    const usd = costUsd("claude-opus-4-8", usage);
    const eur = costEur("claude-opus-4-8", usage);
    expect(usd).toBe(10);
    expect(eur).toBeCloseTo(10 * USD_TO_EUR, 10);
  });

  it("returns undefined for an unknown model", () => {
    expect(costUsd("gpt-5", { inputTokens: 100, outputTokens: 100 })).toBeUndefined();
    expect(costEur("gpt-5", { inputTokens: 100, outputTokens: 100 })).toBeUndefined();
  });
});

describe("runCostEur", () => {
  it("sums priced agents, excludes cached, and reports unpriced model ids", () => {
    const r = report([
      agent({ model: "claude-opus-4-8", inputTokens: 1_000_000, outputTokens: 0 }), // $5
      agent({ model: "claude-sonnet-4-6", inputTokens: 0, outputTokens: 1_000_000 }), // $15
      agent({ model: "claude-opus-4-8", inputTokens: 1_000_000, outputTokens: 0, status: "cached" }), // skipped
      agent({ model: "gpt-5", inputTokens: 1_000_000, outputTokens: 1_000_000 }), // unpriced
    ]);
    const { eur, unpriced } = runCostEur(r);
    expect(eur).toBeCloseTo((5 + 15) * USD_TO_EUR, 10);
    expect(unpriced).toEqual(["gpt-5"]);
  });

  it("flags an agent with no recorded model as unpriced", () => {
    const r = report([agent({ inputTokens: 1_000_000, outputTokens: 0 })]);
    const { eur, unpriced } = runCostEur(r);
    expect(eur).toBe(0);
    expect(unpriced.length).toBe(1);
  });
});
