import { describe, expect, it } from "vitest";
import { drawnSignatureProblem, readPngDimensions } from "./drawn-signature";

// A minimal PNG header: signature, IHDR length + type, width, height.
const png = (width: number, height: number, totalBytes = 64): Uint8Array => {
  const bytes = new Uint8Array(totalBytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

describe("readPngDimensions", () => {
  it("reads width and height from the IHDR chunk", () => {
    expect(readPngDimensions(png(600, 200))).toEqual({ width: 600, height: 200 });
  });

  it("returns null for bytes that are not a PNG", () => {
    expect(readPngDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("drawnSignatureProblem", () => {
  it("accepts a reasonably sized PNG", () => {
    expect(drawnSignatureProblem(png(600, 200))).toBeNull();
  });

  it("rejects something that is not a PNG", () => {
    expect(drawnSignatureProblem(new Uint8Array(100))).toBe("A drawn signature must be a PNG image.");
  });

  it("rejects an image too small to be a signature", () => {
    expect(drawnSignatureProblem(png(10, 5))).toBe(
      "A drawn signature must be between 100×40 and 2000×1000 pixels.",
    );
  });

  it("rejects a file over the size limit", () => {
    expect(drawnSignatureProblem(png(600, 200, 300 * 1024))).toBe(
      "A drawn signature must be smaller than 256 KB.",
    );
  });
});
