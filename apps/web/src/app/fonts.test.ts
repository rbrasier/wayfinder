import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `next/font/google` downloads the font files from Google during `next build`.
// When that request fails the build dies with "An error occurred in next/font",
// which repeatedly failed the container build and the PKI e2e job in CI. The
// fonts are bundled in src/app/fonts instead, so the build needs no network.
const sourceRoot = resolve(__dirname, "..");
const fontsDirectory = resolve(__dirname, "fonts");

const listSourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const entryPath = join(directory, entry);
    if (statSync(entryPath).isDirectory()) return listSourceFiles(entryPath);
    return /\.(ts|tsx)$/.test(entry) ? [entryPath] : [];
  });

describe("bundled fonts", () => {
  it("no source file loads fonts from Google at build time", () => {
    const filesUsingGoogleFonts = listSourceFiles(sourceRoot).filter((filePath) =>
      readFileSync(filePath, "utf-8").includes(`from "next/font/${"google"}"`),
    );

    expect(filesUsingGoogleFonts).toEqual([]);
  });

  it.each(["figtree-latin-wght-normal.woff2", "jetbrains-mono-latin-wght-normal.woff2"])(
    "%s is a WOFF2 font",
    (fileName) => {
      const signature = readFileSync(join(fontsDirectory, fileName)).subarray(0, 4);

      expect(signature.toString("ascii")).toBe("wOF2");
    },
  );

  it.each(["figtree-LICENSE.txt", "jetbrains-mono-LICENSE.txt"])(
    "%s ships the SIL Open Font License the font is distributed under",
    (fileName) => {
      const license = readFileSync(join(fontsDirectory, fileName), "utf-8");

      expect(license).toContain("SIL Open Font License, Version 1.1");
    },
  );
});
