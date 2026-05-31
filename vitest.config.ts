import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    // Projects replace the removed `vitest.workspace.ts` / `defineWorkspace`
    // (Vitest 4 dropped external workspace files — see the migration guide).
    // Same split as before: `unit` excludes e2e, `e2e` runs only e2e files.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts", "packages/*/src/**/*.test.tsx"],
          exclude: ["**/*.e2e.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["packages/*/src/**/*.e2e.test.ts"],
        },
      },
    ],
    // Coverage is a global-only option: per the Vitest docs it must live in
    // this root config and is ignored if set on a workspace project entry.
    coverage: {
      provider: "v8",
      // Cover every package's source, including files no test imported, so the
      // per-package numbers reflect real surface area rather than just hit files.
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: [
        "packages/*/src/**/*.test.{ts,tsx}",
        "packages/*/src/**/*.e2e.test.ts",
        "packages/*/src/**/*.d.ts",
        "**/dist/**",
        "repos/**",
      ],
      // text  -> per-file terminal table, grouped by package directory
      // html  -> ./coverage/index.html, drillable per package
      // json-summary + lcov -> CI gates / external tooling
      reporter: ["text", "html", "json-summary", "lcov"],
      reportsDirectory: "./coverage",
      // Per-package thresholds: a glob key sets its own gate and does NOT
      // inherit the global numbers. Raise these per package as coverage grows.
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
        // "packages/core/src/**": { lines: 85, functions: 85, branches: 75 },
      },
    },
  },
});
