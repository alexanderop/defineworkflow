import { describe, it, expect } from "vitest";
import * as ui from "./index.js";

describe("public API", () => {
  it("exports the entry point, the App, and the pure helpers", () => {
    expect(typeof ui.startUi).toBe("function");
    expect(typeof ui.App).toBe("function");
    expect(typeof ui.createLineLogger).toBe("function");
    expect(typeof ui.formatTokens).toBe("function");
    expect(typeof ui.navReducer).toBe("function");
    expect(typeof ui.orderedPhases).toBe("function");
  });
});
