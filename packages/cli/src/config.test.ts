import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  loadConfig,
  concurrencyCap,
  effectiveConcurrency,
  effectiveMaxAgents,
  type ConfigDeps,
} from "./config.js";

function deps(files: Record<string, string>, env: Record<string, string | undefined> = {}, cores = 12): ConfigDeps {
  return {
    readFile: (p) => files[p],
    homeDir: "/home/me",
    cwd: "/proj",
    cores,
    env,
  };
}

const personal = "/home/me/.workflow/config.json";
const project = "/proj/.workflow/config.json";

describe("loadConfig", () => {
  it("returns defaults when no files exist", () => {
    const cfg = loadConfig(deps({}));
    expect(cfg.concurrency).toBeUndefined();
    expect(cfg.disableWorkflows).toBe(false);
  });

  it("project config overrides personal (project wins)", () => {
    const cfg = loadConfig(
      deps({
        [personal]: JSON.stringify({ maxAgents: 8, concurrency: 4 }),
        [project]: JSON.stringify({ maxAgents: 2 }),
      }),
    );
    expect(cfg.maxAgents).toBe(2);
    expect(cfg.concurrency).toBe(4); // inherited from personal
  });

  it("deep-merges consents across personal and project", () => {
    const cfg = loadConfig(
      deps({
        [personal]: JSON.stringify({ consents: { "/proj": { alpha: true } } }),
        [project]: JSON.stringify({ consents: { "/proj": { beta: true } } }),
      }),
    );
    expect(cfg.consents?.["/proj"]).toEqual({ alpha: true, beta: true });
  });

  it("WORKFLOW_DISABLE=1 forces disableWorkflows", () => {
    const cfg = loadConfig(deps({}, { WORKFLOW_DISABLE: "1" }));
    expect(cfg.disableWorkflows).toBe(true);
  });

  it("ignores malformed JSON gracefully", () => {
    const cfg = loadConfig(deps({ [personal]: "{not json" }));
    expect(cfg.concurrency).toBeUndefined();
  });
});

describe("caps", () => {
  it("clamps concurrency to min(16, cores-2)", () => {
    expect(effectiveConcurrency({ concurrency: 100 }, 12)).toBe(10);
    expect(effectiveConcurrency({ concurrency: 100 }, 64)).toBe(16);
    expect(effectiveConcurrency({}, 12)).toBe(10); // default = the cap
    expect(effectiveConcurrency({ concurrency: 3 }, 12)).toBe(3);
    expect(effectiveConcurrency({ concurrency: 0 }, 12)).toBe(1); // floor of 1
  });

  it("clamps maxAgents to 1000", () => {
    expect(effectiveMaxAgents({ maxAgents: 5000 })).toBe(1000);
    expect(effectiveMaxAgents({})).toBe(1000);
    expect(effectiveMaxAgents({ maxAgents: 50 })).toBe(50);
  });
});

describe("caps (property-based)", () => {
  // These are pure numeric clamps; the bounds must hold for any input, including hostile ones.
  it("concurrencyCap always lands in [1, 16]", () => {
    fc.assert(
      fc.property(fc.integer(), (cores) => {
        const cap = concurrencyCap(cores);
        expect(cap).toBeGreaterThanOrEqual(1);
        expect(cap).toBeLessThanOrEqual(16);
      }),
    );
  });

  it("effectiveConcurrency stays within [1, concurrencyCap(cores)]", () => {
    fc.assert(
      fc.property(fc.option(fc.integer(), { nil: undefined }), fc.integer(), (concurrency, cores) => {
        const result = effectiveConcurrency(concurrency === undefined ? {} : { concurrency }, cores);
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(concurrencyCap(cores));
      }),
    );
  });

  it("effectiveConcurrency honours an in-range request verbatim", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 1024 }), fc.integer({ min: 1, max: 16 }), (cores, request) => {
        fc.pre(request <= concurrencyCap(cores)); // only meaningful when the request is within the cap
        expect(effectiveConcurrency({ concurrency: request }, cores)).toBe(request);
      }),
    );
  });

  it("effectiveMaxAgents always lands in [1, 1000]", () => {
    fc.assert(
      fc.property(fc.option(fc.integer(), { nil: undefined }), (maxAgents) => {
        const result = effectiveMaxAgents(maxAgents === undefined ? {} : { maxAgents });
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(1000);
      }),
    );
  });
});
