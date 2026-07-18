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

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const simpleDocXml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  ${NS}>
  <w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:body>
</w:document>`;

// Builds a document where the tag text is spread across multiple <w:r> runs,
// simulating Word's run-splitting behaviour.
const splitRunDocXml = (...runTexts: string[]) => {
  const runs = runTexts
    .map((text) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}>
  <w:body><w:p>${runs}</w:p></w:body>
</w:document>`;
};

describe("DocxGenerator", () => {
  const generator = new DocxGenerator();

  describe("extractTags", () => {
    it("extracts template variables from a docx buffer", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("{{project_title}} and {{background}}"),
      );

      const result = generator.extractTags({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.tags).toEqual(
        expect.arrayContaining(["project_title", "background"]),
      );
    });

    it("treats single-curly {tag} syntax as plain text and returns no tags", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("{project_title} and {background}"),
      );

      const result = generator.extractTags({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.tags).toEqual([]);
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

    it("extracts a tag when {{ and }} are split across adjacent Word runs", () => {
      // Word frequently splits {{tag}} into separate <w:r> runs when typing or pasting.
      const templateBytes = buildTemplateBuffer(
        splitRunDocXml("{{", "full_name", "}}"),
      );

      const result = generator.extractTags({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.tags).toEqual(["full_name"]);
    });

    it("extracts a tag when only the opening {{ is split across runs", () => {
      const templateBytes = buildTemplateBuffer(
        splitRunDocXml("{", "{full_name}}"),
      );

      const result = generator.extractTags({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.tags).toEqual(["full_name"]);
    });

    it("normalises a descriptive tag with spaces to snake_case", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("{{ Full name }}"),
      );

      const result = generator.extractTags({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.tags).toEqual(["full_name"]);
    });

    it("normalises a descriptive tag containing an em dash", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("{{ Start Date \u2013 the date the person commences }}"),
      );

      const result = generator.extractTags({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.tags).toEqual([
        "start_date_the_date_the_person_commences",
      ]);
    });

    it("handles a paragraph with split runs and a descriptive tag", () => {
      const templateBytes = buildTemplateBuffer(
        splitRunDocXml("Full Name: {{", " Full name ", "}}"),
      );

      const result = generator.extractTags({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.tags).toEqual(["full_name"]);
    });

    it("leaves normal text containing lone braces unchanged", () => {
      // A document may contain { or } in prose (e.g. code examples) without
      // forming a tag — they must not cause errors or be treated as tags.
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("Use format { key: value } for JSON. Also {{actual_tag}}."),
      );

      const result = generator.extractTags({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.tags).toEqual(["actual_tag"]);
    });
  });

  describe("extractFields", () => {
    it("parses annotated tags into typed fields", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("Email: {{ Employee Email (email) }} Fee: {{ Contract Value (currency) (optional) }}"),
      );

      const result = generator.extractFields({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.fields).toEqual([
        expect.objectContaining({ key: "employee_email", label: "Employee Email", type: "email" }),
        expect.objectContaining({
          key: "contract_value",
          label: "Contract Value",
          type: "currency",
          optional: true,
        }),
      ]);
    });

    it("parses an options enum tag split across runs", () => {
      const templateBytes = buildTemplateBuffer(
        splitRunDocXml("Status: {{", " Approval Status (options: Approved, Rejected, Pending) ", "}}"),
      );

      const result = generator.extractFields({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.fields[0]).toMatchObject({ key: "approval_status" });
      expect(result.data?.fields[0].options).toEqual(["Approved", "Rejected", "Pending"]);
    });

    it("returns a validation error for an unknown annotation", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("{{ Name (frobnicate) }}"),
      );

      const result = generator.extractFields({ templateBytes });

      expect(result.error?.code).toBe("VALIDATION_FAILED");
      expect(result.error?.message).toContain("frobnicate");
    });

    it("treats a bare tag as a free-text field", () => {
      const templateBytes = buildTemplateBuffer(simpleDocXml("{{ client_name }}"));

      const result = generator.extractFields({ templateBytes });

      expect(result.data?.fields[0]).toMatchObject({ key: "client_name", type: "text" });
    });
  });

  describe("annotation-aware rendering", () => {
    it("fills an annotated tag using the annotation-stripped key", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("Email: {{ Employee Email (email) }}"),
      );

      const result = generator.generate({
        templateBytes,
        data: { employee_email: "ada@example.com" },
      });

      expect(result.error).toBeUndefined();
      const outputZip = new PizZip(result.data!.docxBytes);
      const outputDoc = new Docxtemplater(outputZip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "{{", end: "}}" },
      });
      expect(outputDoc.getFullText()).toContain("ada@example.com");
    });
  });

  describe("extractFullText", () => {
    it("returns the plain text of a single-paragraph document", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("Hello world"),
      );

      const result = generator.extractFullText({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.text).toBe("Hello world");
    });

    it("preserves {{variable}} placeholders in their sentence context", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("The employee {{full_name}} commences on {{start_date}}."),
      );

      const result = generator.extractFullText({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.text).toContain("{{full_name}}");
      expect(result.data?.text).toContain("{{start_date}}");
      expect(result.data?.text).toContain("The employee");
      expect(result.data?.text).toContain("commences on");
    });

    it("joins multiple paragraphs with newlines and filters empty ones", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>
    <w:p></w:p>
    <w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>
  </w:body>
</w:document>`;
      const templateBytes = buildTemplateBuffer(xml);

      const result = generator.extractFullText({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.text).toBe("First paragraph\nSecond paragraph");
    });

    it("caps text at 32768 characters at a word boundary", () => {
      const longWord = "word ";
      const repeated = longWord.repeat(7000);
      const templateBytes = buildTemplateBuffer(simpleDocXml(repeated));

      const result = generator.extractFullText({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data!.text.length).toBeLessThanOrEqual(32_768);
      expect(result.data!.text).not.toMatch(/\S$/);
    });

    it("returns an error for a malformed buffer", () => {
      const result = generator.extractFullText({
        templateBytes: Buffer.from("not a valid docx"),
      });

      expect(result.error).toBeDefined();
      expect(result.data).toBeUndefined();
    });

    it("returns an error when word/document.xml is missing from the zip", () => {
      const zip = new PizZip();
      zip.file("other.xml", "<root/>");
      const buffer = zip.generate({ type: "nodebuffer" }) as Buffer;

      const result = generator.extractFullText({ templateBytes: buffer });

      expect(result.error).toBeDefined();
    });

    it("handles split runs and still preserves placeholder text", () => {
      const templateBytes = buildTemplateBuffer(
        splitRunDocXml("Name: {{", "full_name", "}}"),
      );

      const result = generator.extractFullText({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.text).toContain("Name:");
      expect(result.data?.text).toContain("full_name");
    });
  });

  describe("generate", () => {
    it("fills template placeholders with provided data", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("{{project_title}} - {{background}}"),
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

    it("generates a document from a template with descriptive tags", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("Name: {{ Full name }} Department: {{ Department code }}"),
      );

      const result = generator.generate({
        templateBytes,
        data: { full_name: "Alice Smith", department_code: "HR-01" },
      });

      expect(result.error).toBeUndefined();
      const outputZip = new PizZip(result.data!.docxBytes);
      const outputDoc = new Docxtemplater(outputZip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "{{", end: "}}" },
      });
      const fullText = outputDoc.getFullText();
      expect(fullText).toContain("Alice Smith");
      expect(fullText).toContain("HR-01");
    });

    it("generates a document from a template with split runs", () => {
      const templateBytes = buildTemplateBuffer(
        splitRunDocXml("Employee: {{", "employee_name", "}}"),
      );

      const result = generator.generate({
        templateBytes,
        data: { employee_name: "Bob Jones" },
      });

      expect(result.error).toBeUndefined();
      const outputZip = new PizZip(result.data!.docxBytes);
      const outputDoc = new Docxtemplater(outputZip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "{{", end: "}}" },
      });
      const fullText = outputDoc.getFullText();
      expect(fullText).toContain("Bob Jones");
    });

    it("renders a section's body when its gate is true and omits it when false", () => {
      const sectionXml = simpleDocXml(
        "Risk: {{#Risk Section}}{{ Mitigation Detail }}{{/Risk Section}} End",
      );

      const included = generator.generate({
        templateBytes: buildTemplateBuffer(sectionXml),
        data: { risk_section: true, mitigation_detail: "Patch the gap" },
      });
      expect(included.error).toBeUndefined();
      const includedText = new Docxtemplater(new PizZip(included.data!.docxBytes), {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "{{", end: "}}" },
      }).getFullText();
      expect(includedText).toContain("Patch the gap");

      const omitted = generator.generate({
        templateBytes: buildTemplateBuffer(sectionXml),
        data: { risk_section: false, mitigation_detail: "Patch the gap" },
      });
      expect(omitted.error).toBeUndefined();
      const omittedText = new Docxtemplater(new PizZip(omitted.data!.docxBytes), {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "{{", end: "}}" },
      }).getFullText();
      expect(omittedText).not.toContain("Patch the gap");
      expect(omittedText).toContain("End");
    });

    it("extracts a section open tag as a gate field and ignores the close tag", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("{{#Risk Section}}{{ Mitigation Detail }}{{/Risk Section}}"),
      );

      const result = generator.extractFields({ templateBytes });
      expect(result.error).toBeUndefined();
      const sectionField = result.data!.fields.find((field) => field.key === "risk_section");
      expect(sectionField?.type).toBe("section");
      expect(result.data!.fields.filter((field) => field.key === "risk_section")).toHaveLength(1);
    });

    it("renders a repeating group once per array item with template-controlled layout", () => {
      const groupXml = simpleDocXml(
        "Recs: {{#Recommendations (repeat)}}[{{ Owner }}: {{ Text }}] {{/Recommendations}}End",
      );

      const result = generator.generate({
        templateBytes: buildTemplateBuffer(groupXml),
        data: {
          recommendations: [
            { owner: "Finance", text: "Cut cost" },
            { owner: "Ops", text: "Add staff" },
          ],
        },
      });
      expect(result.error).toBeUndefined();
      const text = new Docxtemplater(new PizZip(result.data!.docxBytes), {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "{{", end: "}}" },
      }).getFullText();
      expect(text).toContain("[Finance: Cut cost]");
      expect(text).toContain("[Ops: Add staff]");
      expect(text).toContain("End");
    });

    it("extracts a (repeat) block as a group field whose inner tags do not leak top-level", () => {
      const templateBytes = buildTemplateBuffer(
        simpleDocXml("{{#Recommendations (repeat)}}{{ Owner }} {{ Text }}{{/Recommendations}}"),
      );

      const result = generator.extractFields({ templateBytes });
      expect(result.error).toBeUndefined();
      const group = result.data!.fields.find((field) => field.key === "recommendations");
      expect(group?.type).toBe("group");
      expect(group?.itemFields?.map((item) => item.key)).toEqual(["owner", "text"]);
      expect(result.data!.fields.some((field) => field.key === "owner")).toBe(false);
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
        simpleDocXml("Hello {{name}}"),
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
