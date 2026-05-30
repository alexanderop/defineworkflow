import { defineConfig } from "vitepress";

// Repo name → GitHub Pages base path (https://alexanderop.github.io/clanker-workflow/).
const REPO = "clanker-workflow";
const GH_USER = "alexanderop";

export default defineConfig({
  title: "defineworkflow",
  description: "A deterministic, crash-safe multi-agent workflow engine — explained under the hood.",
  base: `/${REPO}/`,
  cleanUrls: true,
  lastUpdated: true,
  appearance: "force-dark",

  head: [
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@500;700;900&family=IBM+Plex+Mono:wght@400;500;600&family=Spectral:ital,wght@0,400;0,500;0,600;1,400&display=swap",
      },
    ],
    ["meta", { name: "theme-color", content: "#ffb000" }],
  ],

  themeConfig: {
    siteTitle: "defineworkflow",
    nav: [
      { text: "Guide", link: "/guide/", activeMatch: "/guide/" },
      { text: "Terminal UI", link: "/guide/terminal-ui" },
      { text: "Adapters", link: "/adapters" },
      { text: "CLI", link: "/cli" },
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "What is workflow?", link: "/guide/" },
          { text: "The terminal UI (playground)", link: "/guide/terminal-ui" },
        ],
      },
      {
        text: "Under the hood",
        collapsed: false,
        items: [
          { text: "The agent() lifecycle", link: "/guide/agent-lifecycle" },
          { text: "Journal & resume", link: "/guide/journal-resume" },
          { text: "Concurrency & the semaphore", link: "/guide/concurrency" },
          { text: "parallel() vs pipeline()", link: "/guide/parallel-pipeline" },
          { text: "Events & RunState", link: "/guide/events" },
          { text: "The sandbox", link: "/guide/sandbox" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Adapters", link: "/adapters" },
          { text: "CLI", link: "/cli" },
          { text: "Diagrams", link: "/guide/diagrams" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: `https://github.com/${GH_USER}/${REPO}` }],
    search: { provider: "local" },
    outline: "deep",
    editLink: {
      pattern: `https://github.com/${GH_USER}/${REPO}/edit/main/apps/docs/:path`,
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Built from the source of @workflow/{schema,core,adapters,cli,ui}.",
      copyright: "Deterministic multi-agent workflow engine.",
    },
  },
});
