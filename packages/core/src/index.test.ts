import { describe, it, expect } from "vitest";
import * as core from "./index.js";

describe("public API", () => {
  it("exports the primitives factory and the building blocks", () => {
    expect(typeof core.createRuntime).toBe("function");
    expect(typeof core.createScriptedRunner).toBe("function");
    expect(typeof core.createJournal).toBe("function");
    expect(typeof core.createSemaphore).toBe("function");
    expect(typeof core.createBudget).toBe("function");
    expect(typeof core.reduce).toBe("function");
    expect(typeof core.runInSandbox).toBe("function");
  });
});
