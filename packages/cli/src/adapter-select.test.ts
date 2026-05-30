import { describe, it, expect } from "vitest";
import { createFakeProcessRunner } from "@workflow/adapters";
import { resolveHarness, buildRunner } from "./adapter-select.js";

describe("resolveHarness", () => {
  it("returns the declared harness when it is a known id", () => {
    for (const id of ["claude", "codex", "copilot", "raw-api"] as const) {
      expect(resolveHarness(id)._unsafeUnwrap()).toBe(id);
    }
  });

  it("errors (HarnessNotDeclared) when meta.harness is missing", () => {
    const r = resolveHarness(undefined);
    expect(r.isErr()).toBe(true);
    const e = r._unsafeUnwrapErr();
    expect(e.kind).toBe("HarnessNotDeclared");
    if (e.kind === "HarnessNotDeclared") expect(e.found).toBeUndefined();
  });

  it("errors (HarnessNotDeclared) and reports the value when meta.harness is unknown", () => {
    const r = resolveHarness("bogus");
    expect(r.isErr()).toBe(true);
    const e = r._unsafeUnwrapErr();
    expect(e.kind).toBe("HarnessNotDeclared");
    if (e.kind === "HarnessNotDeclared") expect(e.found).toBe("bogus");
  });
});

describe("buildRunner", () => {
  const processRunner = createFakeProcessRunner({});

  it("builds a claude/codex/copilot runner with the right id", () => {
    expect(buildRunner("claude", {}, { processRunner })._unsafeUnwrap().id).toBe("claude");
    expect(buildRunner("codex", {}, { processRunner })._unsafeUnwrap().id).toBe("codex");
    expect(buildRunner("copilot", {}, { processRunner })._unsafeUnwrap().id).toBe("copilot");
  });

  it("builds raw-api when a complete fn is supplied", () => {
    const complete = async () => ({ text: "x", usage: { inputTokens: 0, outputTokens: 0 } });
    expect(buildRunner("raw-api", {}, { processRunner, complete })._unsafeUnwrap().id).toBe("raw-api");
  });

  it("errors (AdapterSpawn) for raw-api without a complete fn", () => {
    const r = buildRunner("raw-api", {}, { processRunner });
    expect(r.isErr()).toBe(true);
    expect(r._unsafeUnwrapErr().kind).toBe("AdapterSpawn");
  });
});
