import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { PendingQuestion } from "@workflow/core";

/** A selectable row: a concrete choice, or the "Other → type your own" escape hatch. */
type Item = { readonly kind: "choice"; readonly value: string } | { readonly kind: "other" };

export interface QuestionPromptProps {
  readonly question: PendingQuestion;
  readonly onSubmit: (answer: string) => void;
}

/** Render the question text for display: strip markdown heading markers, drop blank lines. */
function renderLines(question: string): readonly string[] {
  return question
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .filter((l) => l.length > 0);
}

/**
 * Interactive mid-run question: arrow-select a choice and press enter, or pick "Other" (or any
 * choice-less question) to type a free-text answer. Calls `onSubmit` once with the chosen string.
 */
export function QuestionPrompt({ question, onSubmit }: QuestionPromptProps) {
  const choices = question.choices ?? [];
  const hasChoices = choices.length > 0;
  const items: readonly Item[] = [
    ...choices.map((value): Item => ({ kind: "choice", value })),
    ...(question.allowOther ? [{ kind: "other" } as const] : []),
  ];

  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<"select" | "text">(hasChoices ? "select" : "text");
  const [text, setText] = useState("");

  useInput((input, key) => {
    if (mode === "select") {
      if (key.upArrow) setIndex((i) => (i > 0 ? i - 1 : i));
      else if (key.downArrow) setIndex((i) => (i < items.length - 1 ? i + 1 : i));
      else if (key.return) {
        const sel = items[index];
        if (!sel) return;
        if (sel.kind === "other") setMode("text");
        else onSubmit(sel.value);
      }
      return;
    }
    // text mode
    if (key.return) {
      onSubmit(text);
      return;
    }
    if (key.backspace || key.delete) {
      setText((t) => t.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) setText((t) => t + input);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      {renderLines(question.question).map((line, i) => (
        <Text key={i} bold={i === 0}>
          {line}
        </Text>
      ))}
      <Box marginTop={1} flexDirection="column">
        {mode === "select" ? (
          items.map((item, i) => {
            const label = item.kind === "other" ? "Other…" : item.value;
            const selected = i === index;
            return (
              <Text key={i} {...(selected ? { color: "cyan" } : {})}>
                {selected ? "❯ " : "  "}
                {label}
              </Text>
            );
          })
        ) : (
          <Text>
            {"› "}
            {text}
            <Text color="cyan">▌</Text>
          </Text>
        )}
      </Box>
      <Text dimColor>{mode === "select" ? "↑↓ select · ⏎ submit" : "type your answer · ⏎ submit"}</Text>
    </Box>
  );
}
