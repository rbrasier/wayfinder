import { describe, it, expect } from "vitest";
import PizZip from "pizzip";
import { XlsxGenerator, MAX_TEMPLATE_CELLS } from "./xlsx-generator";

// ── fixtures ───────────────────────────────────────────────────────────────

const columnLetter = (index: number): string => {
  let result = "";
  let n = index;
  do {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
};

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

// A cell rendered as an inline string, the simplest self-contained cell form
// (no sharedStrings table needed). An empty string yields an empty cell.
const inlineCell = (reference: string, text: string): string =>
  text === ""
    ? ""
    : `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;

const sheetXml = (grid: string[][]): string => {
  const rows = grid
    .map((cells, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cellXml = cells
        .map((value, columnIndex) => inlineCell(`${columnLetter(columnIndex)}${rowNumber}`, value))
        .join("");
      return `<row r="${rowNumber}">${cellXml}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rows}</sheetData>
</worksheet>`;
};

// Builds a minimal but structurally valid .xlsx from one grid per sheet, wiring
// workbook.xml + rels so sheet order resolves the same way a real workbook does.
const buildXlsx = (...sheets: string[][][]): Buffer => {
  const zip = new PizZip();
  const sheetEntries = sheets.map((_, index) => ({
    part: `xl/worksheets/sheet${index + 1}.xml`,
    relId: `rId${index + 1}`,
    name: `Sheet${index + 1}`,
  }));

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetEntries
    .map((entry, index) => `<sheet name="${entry.name}" sheetId="${index + 1}" r:id="${entry.relId}"/>`)
    .join("")}</sheets>
</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetEntries
    .map(
      (entry) =>
        `<Relationship Id="${entry.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${entry.part.replace("xl/worksheets/", "")}"/>`,
    )
    .join("")}
</Relationships>`,
  );
  sheets.forEach((grid, index) => {
    zip.file(sheetEntries[index]!.part, sheetXml(grid));
  });
  return zip.generate({ type: "nodebuffer" }) as Buffer;
};

// Reads a single sheet's cells back as resolved text, keyed by cell reference,
// so tests can assert on generated output without re-implementing the generator.
const readCells = (bytes: Buffer, part = "xl/worksheets/sheet1.xml"): Record<string, string> => {
  const zip = new PizZip(bytes);
  const xml = zip.file(part)?.asText() ?? "";
  const cells: Record<string, string> = {};
  for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1];
    if (!reference) continue;
    const texts = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
    cells[reference] = texts
      .map((textMatch) => (textMatch[1] ?? "").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">"))
      .join("");
  }
  return cells;
};

// ── tests ────────────────────────────────────────────────────────────────────

describe("XlsxGenerator", () => {
  const generator = new XlsxGenerator();

  describe("extractTags", () => {
    it("collects {{ tags }} from every sheet, trimmed", () => {
      const templateBytes = buildXlsx(
        [["Owner", "{{ Client Name }}"]],
        [["{{ Project Code }}", "notes"]],
      );

      const result = generator.extractTags({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.tags).toEqual(["Client Name", "Project Code"]);
    });

    it("returns no tags when the workbook has none", () => {
      const templateBytes = buildXlsx([["Name", "Email"]]);

      const result = generator.extractTags({ templateBytes });

      expect(result.data?.tags).toEqual([]);
    });

    it("rejects an implausibly large workbook", () => {
      const zip = new PizZip();
      const cells = Array.from({ length: MAX_TEMPLATE_CELLS + 1 }, () => "<c/>").join("");
      zip.file(
        "xl/workbook.xml",
        `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      );
      zip.file(
        "xl/_rels/workbook.xml.rels",
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      );
      zip.file("xl/worksheets/sheet1.xml", `<worksheet><sheetData><row r="1">${cells}</row></sheetData></worksheet>`);
      const templateBytes = zip.generate({ type: "nodebuffer" }) as Buffer;

      const result = generator.extractTags({ templateBytes });

      expect(result.error?.code).toBe("VALIDATION_FAILED");
    });
  });

  // Issue #286: TAG_PATTERN is non-greedy, so a mistyped brace ran forward into
  // the next well-formed tag and both collapsed into one nonsense field.
  describe("malformed tags", () => {
    const subjects = (result: { error?: { details?: readonly { subject: string }[] } }) =>
      (result.error?.details ?? []).map((detail) => detail.subject).join(" | ");

    it("rejects an unclosed tag instead of merging it into the next one", () => {
      const templateBytes = buildXlsx([["{{ Client Name and {{ Other Field }}"]]);

      const result = generator.extractTags({ templateBytes });

      expect(result.data?.tags).toBeUndefined();
      expect(result.error?.code).toBe("VALIDATION_FAILED");
      expect(subjects(result)).toContain("Client Name");
    });

    it("names the cell a malformed tag sits in", () => {
      const templateBytes = buildXlsx([
        ["Owner", "{{ Good Tag }}"],
        ["Ref", "{[ Broken Tag }}"],
      ]);

      const result = generator.extractTags({ templateBytes });

      expect(result.error?.code).toBe("VALIDATION_FAILED");
      expect(result.error?.details?.[0]?.message).toContain("cell B2");
      expect(subjects(result)).toContain("Broken Tag");
    });

    it("lists every tag with an unknown annotation, not just the first", () => {
      const templateBytes = buildXlsx([["{{ Name (frobnicate) }}", "{{ Age (wibble) }}"]]);

      const result = generator.extractFields({ templateBytes });

      expect(result.error?.code).toBe("VALIDATION_FAILED");
      expect(subjects(result)).toContain("Name (frobnicate)");
      expect(subjects(result)).toContain("Age (wibble)");
    });
  });

  describe("extractFields", () => {
    it("parses tag-mode fields when any tag is present, ignoring headings", () => {
      const templateBytes = buildXlsx([
        ["Heading Ignored", "{{ Client Email (email) }}"],
      ]);

      const result = generator.extractFields({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.fields).toHaveLength(1);
      expect(result.data?.fields[0]).toMatchObject({ key: "client_email", type: "email" });
    });

    it("derives header-mode fields from the first non-empty row when no tags exist", () => {
      const templateBytes = buildXlsx([
        [],
        ["Full Name", "Start Date", ""],
        ["existing", "data"],
      ]);

      const result = generator.extractFields({ templateBytes });

      expect(result.error).toBeUndefined();
      expect(result.data?.fields.map((field) => field.key)).toEqual(["full_name", "start_date"]);
      expect(result.data?.fields.every((field) => field.type === "text")).toBe(true);
    });

    it("dedupes repeated headings by key", () => {
      const templateBytes = buildXlsx([["Name", "Name"]]);

      const result = generator.extractFields({ templateBytes });

      expect(result.data?.fields.map((field) => field.key)).toEqual(["name"]);
    });

    it("rejects an (approval) signature tag, naming the limitation", () => {
      const templateBytes = buildXlsx([
        ["{{ Client Email (email) }}", "{{ Delegate Signature (approval) }}"],
      ]);

      const result = generator.extractFields({ templateBytes });

      expect(result.error?.code).toBe("VALIDATION_FAILED");
      expect(result.error?.message).toContain("Delegate Signature");
      expect(result.error?.message).toContain(".docx");
    });

    // A comment cannot outlive the signature it belongs to, so a spreadsheet
    // refuses it either way round: with a signature the signature is refused
    // first, and without one there is nothing for the comment to belong to.
    it("rejects an (approval-comment) tag, naming the tag that cannot be used", () => {
      const withSignature = generator.extractFields({
        templateBytes: buildXlsx([
          [
            "{{ Delegate Signature (approval) }}",
            "{{ Delegate Note (approval-comment: Delegate Signature) }}",
          ],
        ]),
      });
      expect(withSignature.error?.code).toBe("VALIDATION_FAILED");

      const alone = generator.extractFields({
        templateBytes: buildXlsx([
          ["{{ Client Email (email) }}", "{{ Delegate Note (approval-comment) }}"],
        ]),
      });
      expect(alone.error?.code).toBe("VALIDATION_FAILED");
      expect(alone.error?.message).toContain("Delegate Note");
    });

    it("rejects a workbook with no tags and no usable header row", () => {
      const templateBytes = buildXlsx([[], [""]]);

      const result = generator.extractFields({ templateBytes });

      expect(result.error?.code).toBe("VALIDATION_FAILED");
    });

    it("propagates a malformed-tag validation error", () => {
      const templateBytes = buildXlsx([["{{ Amount (unknownannotation) }}"]]);

      const result = generator.extractFields({ templateBytes });

      expect(result.error?.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("detectMode", () => {
    it("reports tags when any tag is present", () => {
      const templateBytes = buildXlsx([["Heading", "{{ tagged }}"]]);
      expect(generator.detectMode({ templateBytes }).data?.mode).toBe("tags");
    });

    it("reports header when no tag is present", () => {
      const templateBytes = buildXlsx([["Heading"]]);
      expect(generator.detectMode({ templateBytes }).data?.mode).toBe("header");
    });
  });

  describe("generate — tag mode", () => {
    it("fills each tag cell in place and preserves untouched cells", () => {
      const templateBytes = buildXlsx([
        ["Owner", "{{ Client Name }}"],
        ["Total", "{{ amount (currency) }}"],
      ]);

      const result = generator.generate({
        templateBytes,
        data: { client_name: "Acme Ltd", amount: "$1,200.00" },
      });

      expect(result.error).toBeUndefined();
      const cells = readCells(result.data!.bytes);
      expect(cells.A1).toBe("Owner");
      expect(cells.B1).toBe("Acme Ltd");
      expect(cells.A2).toBe("Total");
      expect(cells.B2).toBe("$1,200.00");
    });

    it("fills a tag that sits inside surrounding text", () => {
      const templateBytes = buildXlsx([["Dear {{ Client Name }}, welcome"]]);

      const result = generator.generate({
        templateBytes,
        data: { client_name: "Acme Ltd" },
      });

      expect(readCells(result.data!.bytes).A1).toBe("Dear Acme Ltd, welcome");
    });

    it("fills a tag stored as a shared string without disturbing the strings table", () => {
      const zip = new PizZip();
      zip.file(
        "xl/workbook.xml",
        `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      );
      zip.file(
        "xl/_rels/workbook.xml.rels",
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      );
      zip.file(
        "xl/sharedStrings.xml",
        `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>{{ Client Name }}</t></si></sst>`,
      );
      zip.file(
        "xl/worksheets/sheet1.xml",
        `<worksheet><sheetData><row r="1"><c r="A1" s="4" t="s"><v>0</v></c></row></sheetData></worksheet>`,
      );
      const templateBytes = zip.generate({ type: "nodebuffer" }) as Buffer;

      const result = generator.generate({ templateBytes, data: { client_name: "Acme Ltd" } });

      expect(result.error).toBeUndefined();
      const cells = readCells(result.data!.bytes);
      expect(cells.A1).toBe("Acme Ltd");
      // The shared-string entry is untouched; only the cell was rewritten inline.
      const sharedStrings = new PizZip(result.data!.bytes).file("xl/sharedStrings.xml")?.asText() ?? "";
      expect(sharedStrings).toContain("{{ Client Name }}");
      // The style reference survives the in-place rewrite.
      const sheet = new PizZip(result.data!.bytes).file("xl/worksheets/sheet1.xml")?.asText() ?? "";
      expect(sheet).toContain('s="4"');
    });

    it("produces a re-openable workbook", () => {
      const templateBytes = buildXlsx([["{{ name }}"]]);
      const result = generator.generate({ templateBytes, data: { name: "Ok" } });
      expect(() => new PizZip(result.data!.bytes)).not.toThrow();
    });
  });

  describe("generate — header mode", () => {
    it("writes one data row immediately beneath the header row", () => {
      const templateBytes = buildXlsx([["Full Name", "Start Date"]]);

      const result = generator.generate({
        templateBytes,
        data: { full_name: "Dana Scully", start_date: "01-02-2026" },
      });

      expect(result.error).toBeUndefined();
      const cells = readCells(result.data!.bytes);
      expect(cells.A1).toBe("Full Name");
      expect(cells.B1).toBe("Start Date");
      expect(cells.A2).toBe("Dana Scully");
      expect(cells.B2).toBe("01-02-2026");
    });

    it("shifts an existing row below the header down by one", () => {
      const templateBytes = buildXlsx([["Full Name"], ["keep me"]]);

      const result = generator.generate({
        templateBytes,
        data: { full_name: "Dana Scully" },
      });

      const cells = readCells(result.data!.bytes);
      expect(cells.A1).toBe("Full Name");
      expect(cells.A2).toBe("Dana Scully");
      expect(cells.A3).toBe("keep me");
    });
  });

  describe("extractFullText", () => {
    it("concatenates cell text across the workbook", () => {
      const templateBytes = buildXlsx([["Name", "Email"]], [["Notes"]]);
      const result = generator.extractFullText({ templateBytes });
      expect(result.data?.text).toContain("Name");
      expect(result.data?.text).toContain("Email");
      expect(result.data?.text).toContain("Notes");
    });
  });

  describe("annotate", () => {
    it("replaces a cell value with a placeholder", () => {
      const templateBytes = buildXlsx([
        ["Supplier", "Acme Pty Ltd"],
        ["Value", "184500"],
      ]);

      const result = generator.annotate({
        templateBytes,
        edits: [
          { find: "Acme Pty Ltd", occurrence: 0, replacement: "{{ Supplier Name (text) }}" },
        ],
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.appliedCount).toBe(1);
      const text = generator.extractFullText({ templateBytes: result.data!.bytes }).data?.text;
      expect(text).toContain("{{ Supplier Name (text) }}");
      expect(text).not.toContain("Acme Pty Ltd");
    });

    it("re-annotates an existing tag in place", () => {
      const templateBytes = buildXlsx([["Supplier", "{{ Supplier Name }}"]]);

      const result = generator.annotate({
        templateBytes,
        edits: [
          {
            find: "{{ Supplier Name }}",
            occurrence: 0,
            replacement: "{{ Supplier Name (text) (maxlen: 80) }}",
          },
        ],
      });

      expect(result.data?.appliedCount).toBe(1);
      expect(generator.extractTags({ templateBytes: result.data!.bytes }).data?.tags).toEqual([
        "Supplier Name (text) (maxlen: 80)",
      ]);
    });

    it("replaces only the substring, leaving the rest of the cell intact", () => {
      const templateBytes = buildXlsx([["Issued to Acme Pty Ltd on 3 June 2025"]]);

      const result = generator.annotate({
        templateBytes,
        edits: [{ find: "Acme Pty Ltd", occurrence: 0, replacement: "{{ Supplier Name }}" }],
      });

      expect(generator.extractFullText({ templateBytes: result.data!.bytes }).data?.text).toBe(
        "Issued to {{ Supplier Name }} on 3 June 2025",
      );
    });

    it("addresses repeated values by occurrence, across sheets in workbook order", () => {
      const templateBytes = buildXlsx([["Acme Pty Ltd"]], [["Acme Pty Ltd"]]);

      const result = generator.annotate({
        templateBytes,
        edits: [{ find: "Acme Pty Ltd", occurrence: 1, replacement: "{{ Second }}" }],
      });

      expect(result.data?.appliedCount).toBe(1);
      const text = generator.extractFullText({ templateBytes: result.data!.bytes }).data?.text;
      expect(text).toBe("Acme Pty Ltd\n{{ Second }}");
    });

    it("reports an edit whose text is absent rather than dropping it", () => {
      const templateBytes = buildXlsx([["Acme Pty Ltd"]]);

      const result = generator.annotate({
        templateBytes,
        edits: [{ find: "Northwind Ltd", occurrence: 0, replacement: "{{ Supplier Name }}" }],
      });

      expect(result.data?.appliedCount).toBe(0);
      expect(result.data?.unmatched).toHaveLength(1);
    });

    it("returns the workbook unchanged when there are no edits", () => {
      const templateBytes = buildXlsx([["Acme Pty Ltd"]]);

      const result = generator.annotate({ templateBytes, edits: [] });

      expect(result.data?.appliedCount).toBe(0);
      expect(generator.extractFullText({ templateBytes: result.data!.bytes }).data?.text).toBe(
        "Acme Pty Ltd",
      );
    });

    it("converts a header-mode workbook to tag mode, per ADR-039 precedence", () => {
      const templateBytes = buildXlsx([["Supplier", "Value"]]);
      expect(generator.detectMode({ templateBytes }).data?.mode).toBe("header");

      const result = generator.annotate({
        templateBytes,
        edits: [{ find: "Supplier", occurrence: 0, replacement: "{{ Supplier Name (text) }}" }],
      });

      expect(generator.detectMode({ templateBytes: result.data!.bytes }).data?.mode).toBe("tags");
    });
  });
});
