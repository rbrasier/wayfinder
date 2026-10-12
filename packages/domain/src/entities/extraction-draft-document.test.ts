import { describe, expect, it } from "vitest";
import { isSystemFile, unsupportedFileReason } from "./extraction-draft-document";

describe("unsupportedFileReason", () => {
  it("names the file's extension", () => {
    expect(unsupportedFileReason("Pricing Schedule.XLS")).toBe("Skipped: .xls files are not supported.");
  });

  it("falls back to a generic reason when there is no extension", () => {
    expect(unsupportedFileReason("README")).toBe("Skipped: this file type is not supported.");
  });

  it("does not claim a supported type is unsupported when the content did not match it", () => {
    expect(unsupportedFileReason("response.pdf")).toBe(
      "Skipped: the file's content is not a readable .pdf document.",
    );
  });
});

describe("isSystemFile", () => {
  it("recognises macOS archive metadata", () => {
    expect(isSystemFile("__MACOSX/vendor-a/._response.pdf")).toBe(true);
    expect(isSystemFile("vendor-a/._response.pdf")).toBe(true);
    expect(isSystemFile("vendor-a/.DS_Store")).toBe(true);
  });

  it("recognises Windows folder metadata", () => {
    expect(isSystemFile("vendor-a\\Thumbs.db")).toBe(true);
    expect(isSystemFile("desktop.ini")).toBe(true);
  });

  it("leaves real documents alone", () => {
    expect(isSystemFile("vendor-a/response.pdf")).toBe(false);
    expect(isSystemFile("vendor-a/pricing.xls")).toBe(false);
  });
});
