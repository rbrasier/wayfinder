import { describe, it, expect, vi } from "vitest";
import PizZip from "pizzip";
import { ok } from "@rbrasier/domain";
import type { IDocumentGenerator } from "@rbrasier/domain";
import { DocumentGeneratorRouter } from "./document-generator-router";

const zipWith = (entry: string): Buffer => {
  const zip = new PizZip();
  zip.file(entry, "<root/>");
  return zip.generate({ type: "nodebuffer" }) as Buffer;
};

const fakeGenerator = (label: string): IDocumentGenerator => ({
  extractTags: vi.fn().mockReturnValue(ok({ tags: [label] })),
  extractFields: vi.fn().mockReturnValue(ok({ fields: [] })),
  extractFullText: vi.fn().mockReturnValue(ok({ text: label })),
  generate: vi.fn().mockReturnValue(ok({ bytes: Buffer.from(label) })),
});

describe("DocumentGeneratorRouter", () => {
  const docx = fakeGenerator("docx");
  const xlsx = fakeGenerator("xlsx");
  const router = new DocumentGeneratorRouter(docx, xlsx);

  it("routes xlsx bytes (xl/workbook.xml) to the xlsx generator", () => {
    const templateBytes = zipWith("xl/workbook.xml");

    expect(router.extractTags({ templateBytes }).data?.tags).toEqual(["xlsx"]);
    expect(router.generate({ templateBytes, data: {} }).data?.bytes.toString()).toBe("xlsx");
    expect(xlsx.extractTags).toHaveBeenCalledOnce();
    expect(docx.extractTags).not.toHaveBeenCalled();
  });

  it("routes xlsx bytes (worksheets part) to the xlsx generator", () => {
    const templateBytes = zipWith("xl/worksheets/sheet1.xml");
    expect(router.extractFields({ templateBytes }).data?.fields).toEqual([]);
    expect(xlsx.extractFields).toHaveBeenCalledOnce();
  });

  it("routes docx bytes (word/document.xml) to the docx generator", () => {
    const templateBytes = zipWith("word/document.xml");

    expect(router.extractFullText({ templateBytes }).data?.text).toBe("docx");
    expect(docx.extractFullText).toHaveBeenCalledOnce();
    expect(xlsx.extractFullText).not.toHaveBeenCalled();
  });

  it("falls back to the docx generator when the bytes are not a readable zip", () => {
    const templateBytes = Buffer.from("not a zip");
    expect(router.extractTags({ templateBytes }).data?.tags).toEqual(["docx"]);
  });
});
