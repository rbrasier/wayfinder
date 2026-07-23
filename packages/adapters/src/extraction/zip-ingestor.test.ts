import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import type { ArchiveLimits } from "@rbrasier/domain";
import { ZipIngestor } from "./zip-ingestor";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

const pdfBytes = (body: string): Buffer => Buffer.concat([Buffer.from(PDF_MAGIC), Buffer.from(body)]);

const buildZip = (files: Record<string, Buffer | string>): Buffer => {
  const zip = new PizZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generate({ type: "nodebuffer" });
};

const limits = (overrides: Partial<ArchiveLimits> = {}): ArchiveLimits => ({
  maxEntries: 100,
  maxEntryBytes: 1_000_000,
  maxTotalBytes: 5_000_000,
  ...overrides,
});

describe("ZipIngestor.expand", () => {
  it("expands supported files and preserves their folder structure", async () => {
    const archive = buildZip({
      "supplier-a/response.pdf": pdfBytes("alpha content"),
      "notes/summary.txt": "plain notes",
    });

    const result = await new ZipIngestor().expand(archive, limits());

    expect(result.error).toBeUndefined();
    const entries = result.data ?? [];
    const byPath = new Map(entries.map((entry) => [entry.treePath, entry]));
    expect(byPath.get("supplier-a/response.pdf")?.filename).toBe("response.pdf");
    expect(byPath.get("supplier-a/response.pdf")?.mimeType).toBe("application/pdf");
    expect(byPath.get("notes/summary.txt")?.mimeType).toBe("text/plain");
  });

  it("skips unrecognised file types rather than trusting them", async () => {
    const archive = buildZip({
      "response.pdf": pdfBytes("content"),
      "photo.png": Buffer.from("not a document"),
    });

    const result = await new ZipIngestor().expand(archive, limits());

    expect(result.data?.map((entry) => entry.filename)).toEqual(["response.pdf"]);
  });

  it("rejects an archive with more entries than allowed", async () => {
    const archive = buildZip({
      "a.pdf": pdfBytes("a"),
      "b.pdf": pdfBytes("b"),
      "c.pdf": pdfBytes("c"),
    });

    const result = await new ZipIngestor().expand(archive, limits({ maxEntries: 2 }));

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("over the 2-file limit");
  });

  it("rejects an entry larger than the per-file cap", async () => {
    const archive = buildZip({ "big.pdf": pdfBytes("x".repeat(500)) });

    const result = await new ZipIngestor().expand(archive, limits({ maxEntryBytes: 100 }));

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("per-file limit");
  });

  it("rejects an archive that decompresses past the total cap (bomb guard)", async () => {
    const archive = buildZip({
      "a.pdf": pdfBytes("x".repeat(80)),
      "b.pdf": pdfBytes("y".repeat(80)),
    });

    const result = await new ZipIngestor().expand(archive, limits({ maxTotalBytes: 100 }));

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("decompression bomb");
  });

  it("rejects a zip-slip path that escapes the extraction root", async () => {
    const archive = buildZip({ "../escape.pdf": pdfBytes("evil") });

    const result = await new ZipIngestor().expand(archive, limits());

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("unsafe path");
  });

  it("returns an error for bytes that are not a zip", async () => {
    const result = await new ZipIngestor().expand(Buffer.from("not a zip"), limits());

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("not a readable zip");
  });

  it("errors when the archive holds no supported documents", async () => {
    const archive = buildZip({ "photo.png": Buffer.from("image") });

    const result = await new ZipIngestor().expand(archive, limits());

    expect(result.error?.message).toContain("no supported documents");
  });
});
