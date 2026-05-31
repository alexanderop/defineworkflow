import { describe, it, expect } from "vitest";
import { createHeadlessAskUser, parseAnswers } from "./ask-user.js";

describe("parseAnswers", () => {
  it("parses a flat string→string JSON object", () => {
    const r = parseAnswers('{"a":"1","b":"two"}');
    expect(r.isOk() && r.value).toEqual({ a: "1", b: "two" });
  });

  it("returns an empty map for undefined", () => {
    const r = parseAnswers(undefined);
    expect(r.isOk() && r.value).toEqual({});
  });

  it("rejects invalid JSON", () => {
    expect(parseAnswers("{not json}").isErr()).toBe(true);
  });

  it("rejects a non-object or non-string values", () => {
    expect(parseAnswers('{"a":1}').isErr()).toBe(true);
    expect(parseAnswers('["a"]').isErr()).toBe(true);
  });
});

describe("createHeadlessAskUser", () => {
  it("returns a pre-supplied answer matching the question key", async () => {
    const ask = createHeadlessAskUser({ "deploy-target": "production" });
    await expect(ask({ key: "deploy-target", question: "?" })).resolves.toBe("production");
  });

  it("falls back to the question's default when no answer is supplied", async () => {
    const ask = createHeadlessAskUser({});
    await expect(ask({ key: "deploy-target", question: "?", default: "staging" })).resolves.toBe(
      "staging",
    );
  });

  it("prefers a supplied answer over the default", async () => {
    const ask = createHeadlessAskUser({ k: "supplied" });
    await expect(ask({ key: "k", question: "?", default: "fallback" })).resolves.toBe("supplied");
  });

  it("fails fast with UnansweredQuestion when neither an answer nor a default exists", async () => {
    const ask = createHeadlessAskUser({});
    await expect(ask({ key: "deploy-target", question: "?" })).rejects.toMatchObject({
      workflowError: { kind: "UnansweredQuestion", key: "deploy-target" },
    });
  });
});
