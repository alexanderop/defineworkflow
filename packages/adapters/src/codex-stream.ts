import type { AgentProgress, ToolEvent } from "@workflow/core";
import { parseJsonLine, type StreamTranslator, type TranslatorResult } from "./stream.js";

/** Map a codex item.type to a friendly tool name; unknown tool-ish types pass through. */
const TOOL_ITEM_NAMES: Readonly<Record<string, string>> = {
  command_execution: "Shell",
  mcp_tool_call: "Mcp",
  file_change: "Edit",
  web_search: "WebSearch",
};

function toolFromItem(item: Record<string, unknown>): ToolEvent | null {
  const itemType = typeof item.type === "string" ? item.type : "";
  const name = TOOL_ITEM_NAMES[itemType];
  if (!name) return null;
  const input = item.command ?? item.arguments ?? item.query ?? item.path;
  return input !== undefined ? { name, input } : { name };
}

/**
 * Translator for `codex exec --json`.
 * - `thread.started`/`turn.started` → model (when present)
 * - `item.completed` with a tool-ish `item.type` → tool
 * - `item.completed` with `item.type === "agent_message"` → final text
 * - `turn.completed` → usage (tokens)
 */
export function createCodexTranslator(): StreamTranslator {
  let model: string | undefined;
  let text = "";
  let usage = { inputTokens: 0, outputTokens: 0 };

  const readModel = (ev: Record<string, unknown>): string | undefined =>
    typeof ev.model === "string" ? ev.model : undefined;

  return {
    push(line): readonly AgentProgress[] {
      const ev = parseJsonLine(line);
      if (!ev) return [];
      const type = ev.type;

      if (type === "thread.started" || type === "turn.started") {
        const m = readModel(ev);
        if (m) {
          model = m;
          return [{ model }];
        }
        return [];
      }

      if (type === "item.completed") {
        const item = (ev.item ?? {}) as Record<string, unknown>;
        if (item.type === "agent_message") {
          if (typeof item.text === "string") text = item.text;
          return [];
        }
        const tool = toolFromItem(item);
        return tool ? [{ tool }] : [];
      }

      if (type === "turn.completed") {
        // Accumulate across turns: a multi-turn run emits one turn.completed per turn,
        // each carrying that turn's usage. Overwriting would undercount total spend.
        const u = ev.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        usage = {
          inputTokens: usage.inputTokens + (u?.input_tokens ?? 0),
          outputTokens: usage.outputTokens + (u?.output_tokens ?? 0),
        };
        return usage.outputTokens > 0 ? [model !== undefined ? { tokens: usage.outputTokens, model } : { tokens: usage.outputTokens }] : [];
      }

      return [];
    },
    result(): TranslatorResult {
      return { text, usage };
    },
  };
}
