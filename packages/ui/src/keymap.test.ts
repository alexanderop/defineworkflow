import { describe, it, expect } from "vitest";
import { resolveKey, type KeymapCtx } from "./keymap.js";

const phases: KeymapCtx = { focus: "phases", agentKey: undefined };
const agents: KeymapCtx = { focus: "agents", agentKey: "build#0" };
const detail: KeymapCtx = { focus: "detail", agentKey: "build#0" };

describe("resolveKey", () => {
  it("maps arrow keys to nav move/focus actions", () => {
    expect(resolveKey("", { upArrow: true }, phases)).toEqual({ kind: "nav", action: { type: "up" } });
    expect(resolveKey("", { downArrow: true }, phases)).toEqual({ kind: "nav", action: { type: "down" } });
    expect(resolveKey("", { rightArrow: true }, phases)).toEqual({ kind: "nav", action: { type: "right" } });
    expect(resolveKey("", { leftArrow: true }, phases)).toEqual({ kind: "nav", action: { type: "left" } });
  });

  it("maps escape to esc and return to toggleExpand", () => {
    expect(resolveKey("", { escape: true }, detail)).toEqual({ kind: "nav", action: { type: "esc" } });
    expect(resolveKey("", { return: true }, detail)).toEqual({ kind: "nav", action: { type: "toggleExpand" } });
  });

  it("maps j/k to detail scroll", () => {
    expect(resolveKey("j", {}, detail)).toEqual({ kind: "nav", action: { type: "scrollDown" } });
    expect(resolveKey("k", {}, detail)).toEqual({ kind: "nav", action: { type: "scrollUp" } });
  });

  it("maps p to pause and s to save", () => {
    expect(resolveKey("p", {}, phases)).toEqual({ kind: "ui", action: { type: "pause" } });
    expect(resolveKey("s", {}, phases)).toEqual({ kind: "ui", action: { type: "save" } });
  });

  it("x stops the whole run when focused on phases", () => {
    expect(resolveKey("x", {}, phases)).toEqual({
      kind: "ui",
      action: { type: "stop", target: { scope: "run" } },
    });
  });

  it("x stops the selected agent when focused off the phases column", () => {
    expect(resolveKey("x", {}, agents)).toEqual({
      kind: "ui",
      action: { type: "stop", target: { scope: "agent", key: "build#0" } },
    });
    expect(resolveKey("x", {}, detail)).toEqual({
      kind: "ui",
      action: { type: "stop", target: { scope: "agent", key: "build#0" } },
    });
  });

  it("x falls back to stopping the run when no agent is selected", () => {
    expect(resolveKey("x", {}, { focus: "agents", agentKey: undefined })).toEqual({
      kind: "ui",
      action: { type: "stop", target: { scope: "run" } },
    });
  });

  it("r restarts the selected agent, but is inert with no selection", () => {
    expect(resolveKey("r", {}, agents)).toEqual({ kind: "ui", action: { type: "restart", key: "build#0" } });
    expect(resolveKey("r", {}, { focus: "agents", agentKey: undefined })).toBeNull();
  });

  it("returns null for unmapped keys", () => {
    expect(resolveKey("z", {}, phases)).toBeNull();
    expect(resolveKey("", {}, phases)).toBeNull();
  });
});
