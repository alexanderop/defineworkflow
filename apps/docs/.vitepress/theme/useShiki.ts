// Lazily create a single Shiki highlighter shared by every CodeBlock on the page.
// Dynamically imported so it never runs during SSG (build) — only after hydration.
import type { Highlighter } from "shiki";

let promise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!promise) {
    promise = import("shiki").then((s) =>
      s.createHighlighter({
        themes: ["vesper"],
        langs: ["typescript", "javascript", "bash", "json"],
      }),
    );
  }
  return promise;
}
