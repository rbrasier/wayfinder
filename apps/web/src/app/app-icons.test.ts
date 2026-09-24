import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKENS } from "@/lib/design-tokens";

// The tab icon is the unbranded header brand mark. The icon is an SVG file and
// the mark's colour is the --wf-primary default in globals.css (an install's
// brand colour overrides the token, not the icon — ADR-060), so these assertions
// are what stops the two defaults drifting apart.
const readAppFile = (relativePath: string): Buffer =>
  readFileSync(resolve(__dirname, relativePath));

const readPngDimensions = (png: Buffer): { width: number; height: number } => {
  const signature = png.subarray(0, 8).toString("hex");
  expect(signature).toBe("89504e470d0a1a0a");
  expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");

  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

describe("app icons", () => {
  it("icon.svg draws the brand mark on a square canvas", () => {
    const icon = readAppFile("icon.svg").toString("utf-8");

    expect(icon).toContain('viewBox="0 0 32 32"');
    expect(icon).toContain(`fill="${TOKENS.primary}"`);
    expect(icon).toContain('fill="#ffffff"');
  });

  it("apple-icon.png is a 180x180 PNG", () => {
    const { width, height } = readPngDimensions(readAppFile("apple-icon.png"));

    expect(width).toBe(180);
    expect(height).toBe(180);
  });

  it("the unbranded header brand mark uses the same primary as the icon", () => {
    const brandMark = readFileSync(
      resolve(__dirname, "../components/branding/brand-mark.tsx"),
      "utf-8",
    );
    const globals = readFileSync(resolve(__dirname, "../styles/globals.css"), "utf-8");

    expect(brandMark).toContain("bg-wf-primary ");
    expect(globals).toMatch(new RegExp(`--wf-primary:\\s+${TOKENS.primary};`));
  });
});
