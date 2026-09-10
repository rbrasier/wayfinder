import { build } from "esbuild";

// The workspace packages are consumed as TypeScript source — `@wayfinder/adapters`
// resolves to packages/adapters/src/index.ts, and its relative imports are
// extensionless. `tsc` alone therefore emits a dist/ that Node cannot load:
// resolution walks into the workspace source and dies on the first `./db/index`.
// Bundling inlines the workspace packages and leaves real node_modules imports
// (including native ones like onnxruntime-node) as runtime requires.
// Everything else is inlined. The workspace packages are TypeScript source, and
// `@wayfinder/adapters` resolves its peer dependencies (ai, better-auth,
// @langchain/*) from its own node_modules — a resolution base that does not
// survive being emitted into apps/api/dist. Inlining sidesteps that entirely and
// leaves a bundle whose only runtime requirement is the natives below.
// Anything left external must resolve from apps/api/dist at runtime, so each of
// these is also a declared dependency of apps/api. Everything else — including
// langfuse and pino-pretty — is inlined, because adapters' own dependencies live
// in packages/adapters/node_modules and are invisible from here.
const nativeOrUnbundlable = [
  // Native .node binaries: they must be loaded from disk, not inlined.
  "onnxruntime-node",
  "@huggingface/transformers",
  // Reads its own package files at runtime.
  "pdf-parse",
];

await build({
  external: nativeOrUnbundlable,
  entryPoints: ["src/index.ts", "src/cli/migrate.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: true,
  logLevel: "info",
  // Bundled ESM loses the CommonJS interop shims some transitive dependencies
  // expect, so restore `require` for anything reaching for it at runtime.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
});
