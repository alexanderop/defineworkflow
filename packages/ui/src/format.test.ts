import { describe, it, expect } from "vitest";
import {
  formatTokens,
  formatElapsed,
  formatDuration,
  formatModel,
  statusGlyph,
  SPINNER_FRAMES,
} from "./format.js";

describe("formatTokens", () => {
  it("passes through small counts and abbreviates thousands/decimals", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(44000)).toBe("44k");
    expect(formatTokens(318000)).toBe("318k");
  });
});

describe("formatElapsed", () => {
  it("renders seconds, and minutes+padded-seconds past a minute", () => {
    expect(formatElapsed(5000)).toBe("5s");
    expect(formatElapsed(161000)).toBe("2m41s");
    expect(formatElapsed(600000)).toBe("10m00s");
  });
});

describe("formatDuration", () => {
  it("renders Ns under a minute and m:ss at/above one", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(21000)).toBe("21s");
    expect(formatDuration(59999)).toBe("59s");
    expect(formatDuration(60000)).toBe("1:00");
    expect(formatDuration(161000)).toBe("2:41");
  });
});

describe("formatModel", () => {
  it("maps known claude ids to friendly names with context note", () => {
    expect(formatModel("claude-opus-4-8[1m]")).toBe("Opus 4.8 (1M context)");
    expect(formatModel("claude-sonnet-4-6")).toBe("Sonnet 4.6");
    expect(formatModel("claude-haiku-4-5")).toBe("Haiku 4.5");
  });
  it("falls back to the raw id for unknown models and the empty string", () => {
    expect(formatModel("gpt-5-codex")).toBe("gpt-5-codex");
    expect(formatModel("")).toBe("");
  });
});

describe("statusGlyph", () => {
  it("maps statuses to glyphs and animates the running spinner by frame", () => {
    expect(statusGlyph("done")).toBe("✓");
    expect(statusGlyph("failed")).toBe("✗");
    expect(statusGlyph("queued")).toBe("▱");
    expect(statusGlyph("running", 0)).toBe(SPINNER_FRAMES[0]);
    expect(statusGlyph("running", SPINNER_FRAMES.length)).toBe(SPINNER_FRAMES[0]);
  });
});
