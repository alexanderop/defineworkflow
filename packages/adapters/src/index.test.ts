import { describe, it, expect } from "vitest";
import * as adapters from "./index.js";
import { createFakeProcessRunner } from "./fake-process-runner.js";

describe("adapters public API", () => {
  it("exports adapter factories + detection", () => {
    expect(typeof adapters.createClaudeAdapter).toBe("function");
    expect(typeof adapters.createCodexAdapter).toBe("function");
    expect(typeof adapters.createCopilotAdapter).toBe("function");
    expect(typeof adapters.createRawApiAdapter).toBe("function");
    expect(typeof adapters.createGenericAdapter).toBe("function");
    expect(typeof adapters.detectAdapters).toBe("function");
    expect(typeof adapters.createAdapter).toBe("function");
  });

  it("createAdapter builds a known CLI adapter by id", () => {
    const a = adapters.createAdapter("claude", { processRunner: createFakeProcessRunner({}) });
    expect(a.id).toBe("claude");
  });
});
