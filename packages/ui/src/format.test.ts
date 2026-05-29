import { describe, it, expect } from "vitest";
import { formatTokens, formatElapsed, statusGlyph, SPINNER_FRAMES } from "./format.js";

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

describe("statusGlyph", () => {
  it("maps statuses to glyphs and animates the running spinner by frame", () => {
    expect(statusGlyph("done")).toBe("✓");
    expect(statusGlyph("failed")).toBe("✗");
    expect(statusGlyph("queued")).toBe("▱");
    expect(statusGlyph("running", 0)).toBe(SPINNER_FRAMES[0]);
    expect(statusGlyph("running", SPINNER_FRAMES.length)).toBe(SPINNER_FRAMES[0]);
  });
});
