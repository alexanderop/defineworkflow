// A real multi-agent workflow on the Claude Code harness: research the Vue/Nuxt
// ecosystem across many sources in parallel, curate, then synthesize a newsletter.
//
// Run it from this package:
//   pnpm --filter @workflow/examples vue-newsletter
//
// …or directly with the CLI from anywhere:
//   workflow run packages/examples/src/vue-newsletter.workflow.ts --yes
//   workflow run packages/examples/src/vue-newsletter.workflow.ts \
//     --args '{"weekStart":"2026-05-21","weekEnd":"2026-05-28"}' --yes
//
// `defineWorkflow` makes `harness` type-safe for package users. Here it's
// "claude" (Claude Code), so every agent() is a real `claude -p` invocation
// with web search. This spawns real agents and uses tokens.
//
// `workflow` exports the same authoring-time primitives the runtime injects when
// the CLI executes this file. The sandbox strips these imports and binds the
// identifiers to the live runtime.

import { agent, args, defineWorkflow, log, parallel, phase, type JsonSchema } from "defineworkflow";

interface Item {
  title: string;
  url: string;
  summary: string;
  category: string;
  date: string;
  impact: "high" | "medium" | "low";
}
interface SourceResult {
  source: string;
  items: Item[];
}
interface Curated {
  highlights: string[];
  items: Array<{ title: string; url: string; summary: string; category: string; impact: "high" | "medium" | "low" }>;
}

export default defineWorkflow({
  name: "vue-newsletter",
  description: "Research Vue/Nuxt ecosystem sources in parallel and synthesize a weekly newsletter",
  whenToUse:
    'Generate a weekly Vue/Nuxt newsletter. Pass args {weekStart, weekEnd, label} as ISO dates (e.g. {"weekStart":"2026-05-21","weekEnd":"2026-05-28"}). With no args, agents cover the past 7 days from today.',
  harness: "claude",
  // Persist the finished newsletter here. `result.json` holds the full return value
  // verbatim; the `newsletter` string field is also extracted to `newsletter.md`.
  // Omit `output` to print the result to the terminal only.
  output: "./newsletters",
  phases: [
    { title: "Research", detail: "one agent per source — releases, blogs, social, people" },
    { title: "Curate", detail: "dedupe + rank items by impact" },
    { title: "Write", detail: "synthesize the final newsletter" },
  ],
  async run() {
    // Args are optional. Pass {weekStart, weekEnd, label} as ISO dates to scope a week.
    // With no args, agents are told to cover "the past 7 days from today".
    // `args` is `Immutable<JsonValue>` (parsed from the CLI `--args` JSON); narrow it to this run's
    // expected shape. Narrowing via `as` still works; only *mutating* `args` is now a compile error.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the deeply-immutable CLI args payload
    const a = (args ?? {}) as { weekStart?: string; weekEnd?: string; label?: string };
    const hasRange = Boolean(a.weekStart && a.weekEnd);
    const label = a.label ?? (hasRange ? `Week of ${a.weekStart}–${a.weekEnd}` : "this week");
    const window = hasRange
      ? `between ${a.weekStart} and ${a.weekEnd}`
      : "within the past 7 days from today";

    // One agent researches each source, all returning the same shape. A schema is a
    // plain JSON Schema object — the same shape the harness CLI consumes.
    const ITEM: JsonSchema = {
      type: "object",
      properties: {
        title: { type: "string" },
        url: { type: "string" },
        summary: { type: "string", description: "1-3 sentence plain summary of what changed / why it matters" },
        category: { type: "string", enum: ["release", "article", "tooling", "discussion", "tutorial", "people", "other"] },
        date: { type: "string", description: "ISO date if known, else empty" },
        impact: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["title", "url", "summary", "category", "date", "impact"],
      additionalProperties: false,
    };
    const SOURCE_RESULT: JsonSchema = {
      type: "object",
      properties: {
        source: { type: "string" },
        items: { type: "array", items: ITEM },
      },
      required: ["source", "items"],
      additionalProperties: false,
    };

    const SOURCES = [
      {
        key: "core-releases",
        prompt: `Find releases/changelogs published ${window} for these GitHub repos: vuejs/core, vuejs/router (vue-router), vuejs/pinia, vueuse/vueuse, vitejs/vite, vitejs/vitest. For each new release in that window give the version, the highlights, and the release URL. Skip anything outside the date window.`,
      },
      {
        key: "nuxt-releases",
        prompt: `Find releases/changelogs published ${window} for the Nuxt ecosystem on GitHub: nuxt/nuxt, nuxt/ui, nuxt/image, nuxt/content, unjs/nitro, unjs/h3. Give version, highlights, and URL for each release in that window only.`,
      },
      {
        key: "vue-blog",
        prompt: `Check the official Vue.js blog (blog.vuejs.org) and Vue.js news for posts published ${window}. Summarize each post with its URL.`,
      },
      {
        key: "nuxt-blog",
        prompt: `Check the official Nuxt blog (nuxt.com/blog) for posts published ${window}. Summarize each with URL.`,
      },
      {
        key: "hackernews",
        prompt: `Search Hacker News (news.ycombinator.com) for stories about Vue, Nuxt, Vite, or Pinia that were active/posted ${window}. Include the HN discussion URL and the linked article. Note points/comments if visible.`,
      },
      {
        key: "reddit",
        prompt: `Search Reddit r/vuejs and r/Nuxt for notable threads posted ${window} — announcements, releases, popular discussions, showcased projects. Give the reddit thread URL for each.`,
      },
      {
        key: "devto",
        prompt: `Search dev.to for the most useful Vue and Nuxt tagged articles published ${window} (tutorials, deep-dives, tips). Give URLs.`,
      },
      {
        key: "people",
        prompt: `Look for notable updates, posts, or talks ${window} from key Vue/Nuxt people: Evan You (@youyuxi / VoidZero), Daniel Roe (Nuxt lead), Anthony Fu (VueUse/Vitesse/Slidev), Eduardo San Martin Morote (posva — router/pinia), Sébastien Chopin (Nuxt/NuxtLabs). Include VoidZero and NuxtLabs company news too. Give URLs.`,
      },
      {
        key: "newsletters-podcasts",
        prompt: `Find Vue/Nuxt newsletter issues and podcast episodes published ${window}: Vue.js Newsletter (news.vuejs.org), This Week in Vue, Michael Thiessen's newsletter, DejaVue podcast, Vue Mastery content. Summarize and give URLs.`,
      },
    ];

    phase("Research");
    log(`researching ${SOURCES.length} sources for ${label} (${window})…`);

    const raw = await parallel(
      SOURCES.map((s) => () =>
        agent(
          `You are researching the Vue.js / Nuxt ecosystem for a weekly newsletter covering ${label} (${window}).\n\n${s.prompt}\n\nUse web search and fetch real URLs. Only include items genuinely within the date window. Return real, verifiable URLs — never invent links. If you find nothing in the window, return an empty items array. Set "source" to "${s.key}". Set impact based on how much the average Vue developer should care.`,
          { label: `research:${s.key}`, phase: "Research", schema: SOURCE_RESULT, model: "haiku" },
        ),
      ),
    );

    // `schema` makes each agent() resolve to validated structured output (or null if that
    // agent errored). No JSON.parse — validation already happened in the runtime.
    const collected = raw.filter((r): r is SourceResult => r !== null);
    const flatItems = collected.flatMap((c) => c.items.map((it) => ({ ...it, source: c.source })));
    log(`collected ${flatItems.length} items across ${collected.length} sources`);

    phase("Curate");
    const CURATED: JsonSchema = {
      type: "object",
      properties: {
        highlights: {
          type: "array",
          items: { type: "string" },
          description: "3-5 punchy bullets capturing the week's biggest stories",
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              summary: { type: "string" },
              category: { type: "string" },
              impact: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["title", "url", "summary", "category", "impact"],
            additionalProperties: false,
          },
        },
      },
      required: ["highlights", "items"],
      additionalProperties: false,
    };

    // CURATED is a plain JSON Schema (not zod), so agent() resolves to `unknown`; the runtime has
    // already validated it against CURATED, so narrowing to the matching shape is safe here.
    // oxlint-disable-next-line typescript/consistent-type-assertions -- narrow the schema-validated agent output
    const curated = (await agent(
      `Here are raw newsletter candidate items gathered from multiple sources for the Vue/Nuxt week of ${label}:\n\n${JSON.stringify(flatItems, null, 2)}\n\nCurate them:\n1. Remove duplicates (same release/article surfaced by multiple sources — keep the best canonical URL).\n2. Drop low-quality, off-topic, or spammy entries.\n3. Rank by impact (high first).\n4. Write 3-5 punchy "highlights" bullets capturing the week's biggest stories.\nKeep every URL exactly as provided — do not fabricate or alter links.`,
      { phase: "Curate", schema: CURATED },
    )) as Curated;

    log(`curated to ${curated.items.length} items, ${curated.highlights.length} highlights`);

    phase("Write");
    const newsletter = await agent(
      `Write a polished weekly Vue.js / Nuxt newsletter in Markdown for ${label}.\n\nUse this curated data:\n${JSON.stringify(curated, null, 2)}\n\nStructure:\n- A title with the week range and a one-paragraph intro setting the tone.\n- "📌 This Week's Highlights" — the highlights bullets.\n- "🚀 Releases" — version bumps with what changed (group Vue core + Nuxt + tooling).\n- "📝 Articles & Tutorials".\n- "🛠️ Tooling & Ecosystem".\n- "💬 Community & Discussion".\n- "👤 From the Core Team & Community" — people/company news.\n- A short friendly sign-off.\n\nEvery item must be a markdown link to its real URL. Keep summaries tight and developer-focused. Omit any empty section. Output ONLY the markdown newsletter.`,
      { phase: "Write" },
    );

    return { newsletter, itemCount: flatItems.length, curated };
  },
});
