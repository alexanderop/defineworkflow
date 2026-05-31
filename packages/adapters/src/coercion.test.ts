import { describe, it, expect } from "vitest";
import { compileValidator } from "@workflow/schema";
import { runWithSchemaRetry } from "./coercion.js";

const numberValidator = compileValidator({
  type: "object",
  properties: { n: { type: "number" } },
  required: ["n"],
});

describe("runWithSchemaRetry", () => {
  it("returns the result immediately when there is no validator", async () => {
    const r = await runWithSchemaRetry({
      validate: undefined,
      maxRetries: 2,
      attempt: async () => ({
        text: "plain",
        data: undefined,
        usage: { inputTokens: 1, outputTokens: 2 },
      }),
    });
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().text).toBe("plain");
  });

  it("returns data when the validator passes", async () => {
    const r = await runWithSchemaRetry({
      validate: numberValidator,
      maxRetries: 2,
      attempt: async () => ({
        text: "{}",
        data: { n: 5 },
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    });
    expect(r._unsafeUnwrap().data).toEqual({ n: 5 });
  });

  it("retries with feedback when validation fails, then succeeds", async () => {
    const feedback: (string | undefined)[] = [];
    let call = 0;
    const r = await runWithSchemaRetry({
      validate: numberValidator,
      maxRetries: 3,
      attempt: async (retryHint) => {
        feedback.push(retryHint);
        call++;
        return call < 2
          ? { text: "bad", data: { n: "oops" }, usage: { inputTokens: 0, outputTokens: 0 } }
          : { text: "good", data: { n: 7 }, usage: { inputTokens: 0, outputTokens: 0 } };
      },
    });
    expect(r._unsafeUnwrap().data).toEqual({ n: 7 });
    expect(call).toBe(2);
    expect(feedback[0]).toBeUndefined();
    expect(feedback[1]).toMatch(/n/);
  });

  it("returns SchemaValidation error after exhausting retries", async () => {
    const r = await runWithSchemaRetry({
      validate: numberValidator,
      maxRetries: 2,
      attempt: async () => ({
        text: "bad",
        data: { n: "x" },
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    });
    expect(r.isErr()).toBe(true);
    const e = r._unsafeUnwrapErr();
    expect(e.kind).toBe("SchemaValidation");
    expect(e.kind === "SchemaValidation" && e.attempts).toBe(2);
  });

  it("carries the model's actual output in the SchemaValidation error", async () => {
    const r = await runWithSchemaRetry({
      validate: numberValidator,
      maxRetries: 2,
      attempt: async () => ({
        text: "I think the answer is five.",
        data: undefined,
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    });
    const e = r._unsafeUnwrapErr();
    expect(e.kind === "SchemaValidation" && e.rawOutput).toBe("I think the answer is five.");
  });

  it("truncates an oversized raw output in the error", async () => {
    const long = "x".repeat(2000);
    const r = await runWithSchemaRetry({
      validate: numberValidator,
      maxRetries: 1,
      attempt: async () => ({
        text: long,
        data: undefined,
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    });
    const e = r._unsafeUnwrapErr();
    const raw = e.kind === "SchemaValidation" ? (e.rawOutput ?? "") : "";
    expect(raw.length).toBeLessThan(long.length);
    expect(raw).toContain("truncated");
  });
});
