import { describe, it, expect } from "vitest";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { DocxGenerator } from "./docx-generator";

const buildTemplateBuffer = (xmlContent: string): Buffer => {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`,
  );
  zip.file("word/document.xml", xmlContent);
  return zip.generate({ type: "nodebuffer" }) as Buffer;
};

const simpleDocXml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:body>
</w:document>`;

describe("DocxGenerator", () => {
  const generator = new DocxGenerator();

  describe("extractTags", () => {
    it("extracts template variables from a docx buffer", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("{project_title} and {background}"),
      );

      const result = generator.extractTags({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.tags).toEqual(
        expect.arrayContaining(["project_title", "background"]),
      );
    });

    it("returns empty tags array for a template with no placeholders", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("This document has no placeholders."),
      );

      const result = generator.extractTags({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.tags).toEqual([]);
    });

    it("returns an error for a malformed template buffer", () => {
      const malformedBytes = Buffer.from("not a valid docx file");

      const result = generator.extractTags({ templateBytes: malformedBytes });

      expect(result.error).toBeDefined();
      expect(result.data).toBeUndefined();
    });
  });

  describe("generate", () => {
    it("fills template placeholders with provided data", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("{project_title} - {background}"),
      );

      const result = generator.generate({
        templateBytes,
        data: { project_title: "My Project", background: "Context here" },
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.docxBytes).toBeInstanceOf(Buffer);
      expect(result.data?.docxBytes.length).toBeGreaterThan(0);

      const outputZip = new PizZip(result.data!.docxBytes);
      const outputDoc = new Docxtemplater(outputZip, {
        paragraphLoop: true,
        linebreaks: true,
      });
      const fullText = outputDoc.getFullText();
      expect(fullText).toContain("My Project");
      expect(fullText).toContain("Context here");
    });

    it("returns an error when given a malformed template buffer", () => {
      const result = generator.generate({
        templateBytes: Buffer.from("invalid"),
        data: { key: "value" },
      });

      expect(result.error).toBeDefined();
    });

    it("produces valid DOCX bytes that re-parse without error", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("Hello {name}"),
      );

      const result = generator.generate({
        templateBytes,
        data: { name: "World" },
      });

      expect(result.error).toBeUndefined();

      const zip = new PizZip(result.data!.docxBytes);
      const doc = new Docxtemplater(zip, { paragraphLoop: true });
      const fullText = doc.getFullText();
      expect(fullText).toContain("World");
    });
  });
});
