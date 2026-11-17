import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import nodeModule from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";

// Adapters are bundled into the web server by Next's webpack (transpilePackages),
// and webpack rewrites a *named* `createRequire` import into its own require
// machinery: lookups become build-time module ids, or `undefined` outright.
// Unit tests never see that because they run the sources unbundled, so this
// compiles the real files with the exact webpack Next ships and a Node target.

interface WebpackStats {
  toJson(options: { all: false; warnings: true }): { warnings?: { message: string }[] };
}
interface CompiledWebpack {
  init(): void;
  webpack(
    options: Record<string, unknown>,
    callback: (error: Error | null, stats?: WebpackStats) => void,
  ): void;
}

const requireFromHere = nodeModule.createRequire(import.meta.url);
const compiledWebpack = requireFromHere("next/dist/compiled/webpack/webpack") as CompiledWebpack;
compiledWebpack.init();

const adaptersSource = fileURLToPath(new URL("../../../../../packages/adapters/src/", import.meta.url));
const workDirectory = mkdtempSync(join(tmpdir(), "adapters-server-bundle-"));

afterAll(() => rmSync(workDirectory, { recursive: true, force: true }));

const bundleForServer = (relativePath: string): Promise<{ code: string; warnings: string[] }> => {
  const source = readFileSync(join(adaptersSource, relativePath), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const entryName = basename(relativePath).replace(/\.ts$/, ".js");
  const entryPath = join(workDirectory, entryName);
  writeFileSync(entryPath, transpiled);

  return new Promise((resolve, reject) => {
    compiledWebpack.webpack(
      {
        mode: "development",
        devtool: false,
        target: "node",
        context: workDirectory,
        entry: entryPath,
        output: { path: join(workDirectory, "out"), filename: entryName, library: { type: "commonjs2" } },
        // Next parses transpiled workspace sources as javascript/auto; that is the
        // module type under which the rewrite happens.
        module: { rules: [{ test: /\.js$/, type: "javascript/auto" }] },
        externals: [
          ({ request }: { request?: string }, callback: (error?: null, result?: string) => void) => {
            if (request === undefined || request === entryPath) return callback();
            return callback(null, `commonjs ${request}`);
          },
        ],
      },
      (error, stats) => {
        if (error || !stats) return reject(error ?? new Error("webpack produced no stats"));
        const warnings = (stats.toJson({ all: false, warnings: true }).warnings ?? []).map(
          (warning) => warning.message,
        );
        resolve({ code: readFileSync(join(workDirectory, "out", entryName), "utf8"), warnings });
      },
    );
  });
};

describe("adapters bundled into the Next server", () => {
  it.each(["ai/local-embeddings-adapter.ts", "logging/pino-logger.ts"])(
    "%s keeps Node's own createRequire",
    async (relativePath) => {
      const { code, warnings } = await bundleForServer(relativePath);

      expect(warnings.filter((message) => message.includes("Critical dependency"))).toEqual([]);
      expect(code).not.toContain("/* createRequire() */");
      expect(code).toContain(".createRequire(");
    },
    30_000,
  );
});
