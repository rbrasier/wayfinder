import { describe, expect, it } from "vitest";
import { DOCX_MIME, PDF_MIME, sniffMimeType } from "./mime-sniff";

const withMagic = (magic: number[], tail = "rest of file"): Buffer =>
  Buffer.concat([Buffer.from(magic), Buffer.from(tail)]);

describe("sniffMimeType", () => {
  it("identifies a PDF by its %PDF signature regardless of extension", () => {
    const pdf = withMagic([0x25, 0x50, 0x44, 0x46]);
    expect(sniffMimeType(pdf, "response.pdf")).toBe(PDF_MIME);
    expect(sniffMimeType(pdf, "response.doc")).toBe(PDF_MIME);
  });

  it("only trusts a zip signature as DOCX when the name is .docx", () => {
    const zip = withMagic([0x50, 0x4b, 0x03, 0x04]);
    expect(sniffMimeType(zip, "response.docx")).toBe(DOCX_MIME);
    expect(sniffMimeType(zip, "archive.zip")).toBeNull();
  });

  it("falls back to the extension for text formats", () => {
    const text = Buffer.from("plain content");
    expect(sniffMimeType(text, "notes.txt")).toBe("text/plain");
    expect(sniffMimeType(text, "data.csv")).toBe("text/csv");
    expect(sniffMimeType(text, "readme.md")).toBe("text/markdown");
  });

  it("returns null for an unrecognised type", () => {
    expect(sniffMimeType(Buffer.from("anything"), "photo.png")).toBeNull();
  });
});
