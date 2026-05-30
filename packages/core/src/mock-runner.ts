import { ok, type Result } from "neverthrow";
import type { AgentRunner, AgentRequest, AgentResult, JsonSchema, RunCtx } from "./types.js";
import type { WorkflowError } from "./errors.js";

/**
 * Fabricate the smallest value that satisfies a JSON Schema, so a mock agent's
 * structured output passes the same validation a real agent's would. Covers the
 * subset workflows actually use: object/array/string/number/integer/boolean and
 * `enum`. Only declared properties are emitted, so `additionalProperties: false`
 * holds; every `required` field is present because it must also be a declared
 * property. Unknown shapes fall back to null.
 */
export function mockFromSchema(schema: JsonSchema): unknown {
  const enumValues = schema["enum"];
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];

  const type = schema["type"];
  switch (type) {
    case "object": {
      const propsValue = schema["properties"];
      const props: Record<string, unknown> =
        typeof propsValue === "object" && propsValue !== null ? { ...propsValue } : {};
      const out: Record<string, unknown> = {};
      for (const [key, propSchema] of Object.entries(props)) {
        if (typeof propSchema === "object" && propSchema !== null) {
          out[key] = mockFromSchema({ ...propSchema });
        }
      }
      return out;
    }
    case "array": {
      const items = schema["items"];
      return typeof items === "object" && items !== null ? [mockFromSchema({ ...items })] : [];
    }
    case "string":
      return "mock";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      // No declared type but has properties → treat as object; otherwise give up.
      if (schema["properties"]) return mockFromSchema({ ...schema, type: "object" });
      return null;
  }
}

export interface MockRunnerOptions {
  /** Artificial per-call delay so concurrency/UI animation is observable in a mock run. */
  readonly delayMs?: number;
}

/**
 * A runner that fabricates plausible, schema-valid responses without spawning any
 * real agent — the backend for `workflow run --mock`, letting authors iterate on a
 * workflow's control flow, phases, and UI for free. Deterministic: no clocks or
 * randomness, so journal replay still holds.
 */
export function createMockRunner(options: MockRunnerOptions = {}): AgentRunner {
  const delayMs = options.delayMs ?? 0;

  const run = async (req: AgentRequest, _ctx: RunCtx): Promise<Result<AgentResult, WorkflowError>> => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const data = req.schema ? mockFromSchema(req.schema) : undefined;
    const text = req.schema ? JSON.stringify(data) : `[mock] ${req.label ?? "agent"}: ${req.prompt.split("\n")[0] ?? ""}`;
    return ok({
      text,
      ...(data !== undefined ? { data } : {}),
      usage: { inputTokens: 0, outputTokens: 0 },
      toolCalls: [],
    });
  };

  return {
    id: "mock",
    capabilities: { nativeSchema: true, reportsTokens: false, toolEvents: false },
    run,
  };
}
