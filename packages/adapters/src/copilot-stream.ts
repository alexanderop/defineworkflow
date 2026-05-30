import type { AgentProgress, ToolEvent } from "@workflow/core";
import { parseJsonLine, type StreamTranslator, type TranslatorResult } from "./stream.js";

/**
 * Translator for `copilot --output-format json`.
 * - `session.*` → model (when present), otherwise skipped as noise
 * - `assistant.tool_call` (or `tool_call`) → tool
 * - `assistant.message_delta` / `assistant.turn_end` → tokens
 * - `result` → final text + usage (+ is_error)
 */
export function createCopilotTranslator(): StreamTranslator {
  let model: string | undefined;
  let text = "";
  let usage = { inputTokens: 0, outputTokens: 0 };
  let isError = false;
  let errorMessage: string | undefined;

  const tokensOf = (ev: Record<string, unknown>): number | undefined => {
    const u = ev.usage as { output_tokens?: number } | undefined;
    if (typeof u?.output_tokens === "number") return u.output_tokens;
    return typeof ev.output_tokens === "number" ? ev.output_tokens : undefined;
  };

  return {
    push(line): readonly AgentProgress[] {
      const ev = parseJsonLine(line);
      if (!ev) return [];
      const type = typeof ev.type === "string" ? ev.type : "";

      if (type.startsWith("session")) {
        if (typeof ev.model === "string") {
          model = ev.model;
          return [{ model }];
        }
        return [];
      }

      if (type === "assistant.tool_call" || type === "tool_call") {
        const name = typeof ev.name === "string" ? ev.name : undefined;
        if (!name) return [];
        const input = ev.arguments ?? ev.input;
        return [{ tool: input !== undefined ? { name, input } : ({ name } as ToolEvent) }];
      }

      if (type === "assistant.message_delta" || type === "assistant.turn_end") {
        const tokens = tokensOf(ev);
        if (typeof tokens === "number") return [model !== undefined ? { tokens, model } : { tokens }];
        return [];
      }

      if (type === "result") {
        const result = ev.result ?? ev.text;
        text = typeof result === "string" ? result : JSON.stringify(result ?? "");
        const tokens = tokensOf(ev);
        if (typeof tokens === "number") usage = { inputTokens: 0, outputTokens: tokens };
        if (ev.is_error === true) {
          isError = true;
          errorMessage = "copilot reported is_error";
        }
        return [];
      }

      return [];
    },
    result(): TranslatorResult {
      return {
        text,
        usage,
        ...(isError ? { isError } : {}),
        ...(errorMessage !== undefined ? { errorMessage } : {}),
      };
    },
  };
}
