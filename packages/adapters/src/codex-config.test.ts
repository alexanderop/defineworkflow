import { describe, it, expect } from "vitest";
import { parseCodexModel } from "./codex-config.js";

describe("parseCodexModel", () => {
  it("reads the top-level model key", () => {
    expect(parseCodexModel('model = "gpt-5.5"\napproval_policy = "never"')).toBe("gpt-5.5");
  });

  it("supports single quotes and surrounding whitespace", () => {
    expect(parseCodexModel("  model='o3-mini' ")).toBe("o3-mini");
  });

  it("reads a profile's model when a profile is named", () => {
    const toml = 'model = "gpt-5.5"\n\n[profiles.fast]\nmodel = "o4-mini"\n';
    expect(parseCodexModel(toml, "fast")).toBe("o4-mini");
  });

  it("falls back to top-level model when the named profile has none", () => {
    const toml = 'model = "gpt-5.5"\n[profiles.fast]\napproval_policy = "never"\n';
    expect(parseCodexModel(toml, "fast")).toBe("gpt-5.5");
  });

  it("ignores a model key that belongs to a different table", () => {
    const toml = '[profiles.other]\nmodel = "nope"\n';
    expect(parseCodexModel(toml)).toBeUndefined();
    expect(parseCodexModel(toml, "fast")).toBeUndefined();
  });

  it("returns undefined for empty or model-less config", () => {
    expect(parseCodexModel("")).toBeUndefined();
    expect(parseCodexModel('approval_policy = "never"')).toBeUndefined();
  });
});
