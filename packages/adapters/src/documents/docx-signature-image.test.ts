import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { DocxGenerator } from "./docx-generator";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const template = (body: string): Buffer => {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
  );
  return zip.generate({ type: "nodebuffer" }) as Buffer;
};

const png = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

const render = (images: Record<string, Buffer>, value = "Approved by:   Jane Doe") => {
  const result = new DocxGenerator().generate({
    templateBytes: template("<w:p><w:r><w:t>{{delegate_signature}}</w:t></w:r></w:p>"),
    data: { delegate_signature: value },
    images,
  });
  if (result.error) throw new Error(result.error.message);
  return new PizZip(result.data.bytes);
};

describe("DocxGenerator signature images", () => {
  it("places the drawing in the slot, above the attestation text", () => {
    const zip = render({ delegate_signature: png(600, 200) });
    const documentXml = zip.file("word/document.xml")!.asText();

    expect(documentXml).toContain("<w:drawing>");
    expect(documentXml.indexOf("<w:drawing>")).toBeLessThan(documentXml.indexOf("Approved by:"));
    expect(documentXml).not.toContain("wf-img");
  });

  it("stores the image as a media part, related and typed", () => {
    const zip = render({ delegate_signature: png(600, 200) });

    expect(zip.file("word/media/wf-signature-delegate_signature.png")).not.toBeNull();
    const rels = zip.file("word/_rels/document.xml.rels")!.asText();
    expect(rels).toMatch(/Id="rIdWfSig1"[^>]*Target="media\/wf-signature-delegate_signature\.png"/);
    expect(rels).toContain('Id="rId1"');
    expect(zip.file("[Content_Types].xml")!.asText()).toContain('Extension="png"');
  });

  it("keeps the aspect ratio at a fixed signature height", () => {
    const zip = render({ delegate_signature: png(600, 200) });
    const documentXml = zip.file("word/document.xml")!.asText();

    expect(documentXml).toContain('<wp:extent cx="1371600" cy="457200"/>');
  });

  it("renders an undecided slot as empty, with no picture", () => {
    const zip = render({ delegate_signature: png(600, 200) }, "");
    const documentXml = zip.file("word/document.xml")!.asText();

    expect(documentXml).not.toContain("<w:drawing>");
    expect(zip.file("word/media/wf-signature-delegate_signature.png")).toBeNull();
  });

  it("renders text alone when no image is given", () => {
    const zip = render({});

    expect(zip.file("word/document.xml")!.asText()).not.toContain("<w:drawing>");
  });

  it("ignores bytes that are not a PNG rather than writing a broken picture", () => {
    const zip = render({ delegate_signature: Buffer.from("not a png") });
    const documentXml = zip.file("word/document.xml")!.asText();

    expect(documentXml).not.toContain("<w:drawing>");
    expect(documentXml).not.toContain("wf-img");
    expect(documentXml).toContain("Approved by:");
  });
});
