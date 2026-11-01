import { describe, expect, it } from "vitest";
import { chooseAnalysisSample, isSystemFile, unsupportedFileReason } from "./extraction-draft-document";

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

describe("chooseAnalysisSample", () => {
  const file = (treePath: string) => ({ filename: treePath.split("/").pop()!, treePath });

  it("spreads the sample across sub-folders instead of taking the first folder's files", () => {
    const staged = [
      file("acme/proposal.docx"),
      file("acme/pricing.pdf"),
      file("acme/notes.txt"),
      file("globex/proposal.docx"),
      file("initech/proposal.docx"),
    ];

    expect(chooseAnalysisSample(staged, 3).map((document) => document.treePath)).toEqual([
      "acme/proposal.docx",
      "globex/proposal.docx",
      "initech/proposal.docx",
    ]);
  });

  it("varies the file type within a folder before repeating one", () => {
    const staged = [file("acme/a.docx"), file("acme/b.docx"), file("acme/c.pdf")];

    expect(chooseAnalysisSample(staged, 2).map((document) => document.treePath)).toEqual([
      "acme/a.docx",
      "acme/c.pdf",
    ]);
  });

  it("leaves out files extraction cannot read", () => {
    const staged = [file("acme/workbook.xls"), file("acme/proposal.docx")];

    expect(chooseAnalysisSample(staged, 3).map((document) => document.treePath)).toEqual([
      "acme/proposal.docx",
    ]);
  });

  it("returns every candidate in sample order when no limit applies", () => {
    const staged = [file("a/1.pdf"), file("a/2.pdf"), file("b/1.pdf")];

    expect(chooseAnalysisSample(staged).map((document) => document.treePath)).toEqual([
      "a/1.pdf",
      "b/1.pdf",
      "a/2.pdf",
    ]);
  });
});

