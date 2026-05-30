// A minimal real workflow: one agent() call.
//
// Run it from this package:
//   pnpm --filter @workflow/examples haiku
//
// …or directly with the CLI from anywhere:
//   workflow run packages/examples/src/haiku.workflow.ts --yes
//
// `meta.harness` declares the coding harness this workflow runs on — it is
// required and is the single source of truth (no auto-detect, no CLI/config
// override). Set it to a CLI you have installed: "claude" | "codex" |
// "copilot", or "raw-api" to call the Anthropic API directly (needs
// ANTHROPIC_API_KEY). This spawns a real agent, so it will use tokens.

export const meta = {
  name: "haiku",
  description: "Ask an agent to write a haiku about durable workflows",
  harness: "claude",
  phases: [{ title: "Write" }],
};

phase("Write");
log("asking the agent for a haiku…");

const poem = await agent("Write a haiku about durable, crash-safe workflows. Return only the haiku.", {
  label: "haiku-writer",
  phase: "Write",
});

return { poem };
