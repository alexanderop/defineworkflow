import type { AgentProgress, ToolEvent } from "@workflow/core";
import { asRecord, parseJsonLine, type StreamTranslator, type TranslatorResult } from "./stream.js";

interface AssistantContentBlock {
  readonly type?: string;
  readonly name?: string;
  readonly input?: unknown;
}

/** Narrow an `unknown` JSON value to an array of content blocks (each block re-read field-by-field). */
function asContentBlocks(value: unknown): readonly AssistantContentBlock[] {
  if (!Array.isArray(value)) return [];
  const blocks: AssistantContentBlock[] = [];
  for (const entry of value) {
    const rec = asRecord(entry);
    if (!rec) continue;
    blocks.push({
      ...(typeof rec.type === "string" ? { type: rec.type } : {}),
      ...(typeof rec.name === "string" ? { name: rec.name } : {}),
      ...("input" in rec ? { input: rec.input } : {}),
    });
  }
  return blocks;
}

/** Read an optional numeric field from an `unknown` JSON value (objects only). */
function numberField(value: unknown, key: string): number | undefined {
  const rec = asRecord(value);
  const n = rec?.[key];
  return typeof n === "number" ? n : undefined;
}

/**
 * Translator for `claude --output-format stream-json --verbose`.
 * - `system`/`init` → model
 * - `assistant` → one tool event per `tool_use` content block; `message.usage.output_tokens` → tokens
 * - `result` → final text + `structured_output` + usage (+ is_error)
 *
 * Noise skipped: `hook_started`, `hook_response`, `rate_limit_event`, `notification`, `user`.
 */
export function createClaudeTranslator(): StreamTranslator {
  let model: string | undefined;
  let text = "";
  let structuredOutput: unknown;
  let usage = { inputTokens: 0, outputTokens: 0 };
  let cumulativeOutput = 0; // running total across assistant messages, for live tokens
  let isError = false;
  let errorMessage: string | undefined;

  return {
    push(line): readonly AgentProgress[] {
      const ev = parseJsonLine(line);
      if (!ev) return [];
      const type = ev.type;

      if (type === "system" && ev.subtype === "init") {
        if (typeof ev.model === "string") {
          model = ev.model;
          return [{ model }];
        }
        return [];
      }

      if (type === "assistant") {
        const message = asRecord(ev.message);
        const out: AgentProgress[] = [];
        const content = asContentBlocks(message?.content);
        for (const block of content) {
          if (block.type === "tool_use" && typeof block.name === "string") {
            const tool: ToolEvent =
              block.input !== undefined
                ? { name: block.name, input: block.input }
                : { name: block.name };
            out.push({ tool });
          }
        }
        // Each assistant message reports its own output_tokens; sum them so the live
        // `tokens` is the cumulative count the contract promises (final usage still
        // comes authoritatively from the `result` event).
        const tokens = numberField(message?.usage, "output_tokens");
        if (typeof tokens === "number") {
          cumulativeOutput += tokens;
          out.push(
            model !== undefined
              ? { tokens: cumulativeOutput, model }
              : { tokens: cumulativeOutput },
          );
        }
        return out;
      }

      if (type === "result") {
        const result = ev.result;
        // Absent result → empty text (lets the adapter distinguish "no output" from "output").
        text =
          typeof result === "string" ? result : result === undefined ? "" : JSON.stringify(result);
        if (ev.structured_output !== undefined) structuredOutput = ev.structured_output;
        usage = {
          inputTokens: numberField(ev.usage, "input_tokens") ?? 0,
          outputTokens: numberField(ev.usage, "output_tokens") ?? 0,
        };
        if (ev.is_error === true) {
          isError = true;
          errorMessage = "claude reported is_error";
        }
        return [];
      }

      return [];
    },
    result(): TranslatorResult {
      return {
        text,
        ...(structuredOutput !== undefined ? { data: structuredOutput } : {}),
        usage,
        ...(isError ? { isError } : {}),
        ...(errorMessage !== undefined ? { errorMessage } : {}),
      };
    },
  };
}
