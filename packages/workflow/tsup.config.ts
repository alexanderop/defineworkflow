import { defineConfig } from "tsup";

// `defineworkflow` is published as a SINGLE self-contained package. The internal
// `@workflow/*` workspace packages are bundled into dist/ (noExternal) so the
// published tarball carries no `workspace:*` dependencies. Genuine third-party
// runtime deps stay external and are declared in package.json `dependencies` —
// notably `esbuild`, which ships a platform-specific native binary and MUST NOT
// be bundled.
export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  // `resolve` forces the .d.ts rollup to inline the workspace `@workflow/*`
  // types instead of leaving `import … from "@workflow/core"` in the output —
  // those packages are not published, so an external import would break
  // TypeScript consumers of `defineworkflow`.
  dts: { resolve: [/^@workflow\//] },
  clean: true,
  // Pull the workspace packages (and their workspace-internal deps) into the bundle.
  noExternal: [/^@workflow\//],
  // Everything below is resolved from the consumer's node_modules at runtime.
  external: [
    "@anthropic-ai/sdk",
    "acorn",
    "ajv",
    "esbuild",
    "ink",
    "neverthrow",
    "react",
    "zod",
  ],
});
