import { describe, it, expect } from "vitest";
import { z } from "zod";
import { runWithSchemaRetry } from "./coercion.js";

const zodValidator = (schema: z.ZodType) => (data: unknown): readonly string[] | null => {
  const r = schema.safeParse(data);
  return r.success ? null : r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
};

describe("runWithSchemaRetry", () => {
  it("returns the result immediately when there is no validator", async () => {
    const r = await runWithSchemaRetry({
      validate: undefined,
      maxRetries: 2,
      attempt: async () => ({ text: "plain", data: undefined, usage: { inputTokens: 1, outputTokens: 2 } }),
    });
    expect(r.isOk()).toBe(true);
    expect(r._unsafeUnwrap().text).toBe("plain");
  });

  it("returns data when the validator passes", async () => {
    const r = await runWithSchemaRetry({
      validate: zodValidator(z.object({ n: z.number() })),
      maxRetries: 2,
      attempt: async () => ({ text: "{}", data: { n: 5 }, usage: { inputTokens: 0, outputTokens: 0 } }),
    });
    expect(r._unsafeUnwrap().data).toEqual({ n: 5 });
  });

  it("retries with feedback when validation fails, then succeeds", async () => {
    const feedback: (string | undefined)[] = [];
    let call = 0;
    const r = await runWithSchemaRetry({
      validate: zodValidator(z.object({ n: z.number() })),
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
      validate: zodValidator(z.object({ n: z.number() })),
      maxRetries: 2,
      attempt: async () => ({ text: "bad", data: { n: "x" }, usage: { inputTokens: 0, outputTokens: 0 } }),
    });
    expect(r.isErr()).toBe(true);
    const e = r._unsafeUnwrapErr();
    expect(e.kind).toBe("SchemaValidation");
    expect(e.kind === "SchemaValidation" && e.attempts).toBe(2);
  });
});
