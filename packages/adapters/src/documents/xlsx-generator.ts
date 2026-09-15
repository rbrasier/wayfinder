import PizZip from "pizzip";
import { deriveFieldKey, domainError, err, ok, parseTemplateFields, templateFieldKey } from "@wayfinder/domain";
import type { DomainError, DomainErrorDetail } from "@wayfinder/domain";
import { detailsFromTagContent, headlineFor, tagSyntaxIssues } from "./tag-syntax";
import type {
  AnnotateInput,
  AnnotateOutput,
  ExtractFieldsInput,
  ExtractFieldsOutput,
  ExtractFullTextInput,
  ExtractFullTextOutput,
  ExtractTagsInput,
  ExtractTagsOutput,
  GenerateInput,
  GenerateOutput,
  IDocumentGenerator,
  Result,
  TemplateAnnotationEdit,
  TemplateField,
} from "@wayfinder/domain";

// Upper bound on cells scanned across the whole workbook. An .xlsx template is a
// header table or a tagged sheet, never a data warehouse — a workbook past this
// is rejected rather than scanned (ADR-039 risk: bound the all-cell scan).
export const MAX_TEMPLATE_CELLS = 200_000;

const TAG_PATTERN = /\{\{([\s\S]*?)\}\}/g;

interface SheetGrid {
  // Resolved cell text keyed by 1-based row number, each row a sparse array of
  // column-indexed values.
  rows: string[][];
}

// Reads and writes .xlsx templates behind IDocumentGenerator (ADR-039). Reading
// mirrors the HR SpreadsheetParser's PizZip approach — no SheetJS-style library.
// Two authoring conventions: any {{ tag }} anywhere ⇒ tag mode (fill in place);
// otherwise header mode (first non-empty row names the fields, one data row is
// written beneath). Detection is pure so the upload route and the renderer agree.
export class XlsxGenerator implements IDocumentGenerator {
  extractTags(input: ExtractTagsInput): Result<ExtractTagsOutput> {
    try {
      const zip = new PizZip(input.templateBytes);
      return this.collectRawTags(zip);
    } catch (cause) {
      return err(domainError("VALIDATION_FAILED", INVALID_XLSX_MESSAGE, cause));
    }
  }

  extractFields(input: ExtractFieldsInput): Result<ExtractFieldsOutput> {
    try {
      const zip = new PizZip(input.templateBytes);
      const tagsResult = this.collectRawTags(zip);
      if (tagsResult.error) return tagsResult;

      if (tagsResult.data.tags.length > 0) {
        const parsed = parseTemplateFields(tagsResult.data.tags);
        if (parsed.error) return err(this.tagContentFailure(tagsResult.data.tags, parsed.error));

        // Signature semantics in a spreadsheet cell are unclear — cell geometry,
        // and header-mode templates that carry no tags at all — and guessing
        // would produce a signature nobody can rely on. Rejected at upload with
        // the limitation named, rather than silently at render (ADR-043 §7).
        const signature = parsed.data.find((field) => field.type === "signature");
        if (signature) {
          return err(
            domainError(
              "VALIDATION_FAILED",
              `"${signature.label}" uses the (approval) signature tag, which is only supported in Word (.docx) templates. Remove it from this spreadsheet.`,
            ),
          );
        }
        return ok({ fields: parsed.data });
      }

      return this.headerFields(zip);
    } catch (cause) {
      return err(domainError("VALIDATION_FAILED", INVALID_XLSX_MESSAGE, cause));
    }
  }

  extractFullText(input: ExtractFullTextInput): Result<ExtractFullTextOutput> {
    try {
      const zip = new PizZip(input.templateBytes);
      const sharedStrings = readSharedStrings(zip);
      const lines: string[] = [];
      for (const part of allSheetParts(zip)) {
        const grid = readSheetGrid(zip.file(part)?.asText() ?? "", sharedStrings);
        for (const row of grid.rows) {
          const text = row.filter((value) => value && value.trim()).join(" ");
          if (text.trim()) lines.push(text);
        }
      }
      return ok({ text: capText(lines.join("\n"), 32_768) });
    } catch (cause) {
      return err(domainError("VALIDATION_FAILED", "Failed to extract text from the spreadsheet.", cause));
    }
  }

  generate(input: GenerateInput): Result<GenerateOutput> {
    try {
      const zip = new PizZip(input.templateBytes);
      const tagsResult = this.collectRawTags(zip);
      if (tagsResult.error) return tagsResult;

      const values = stringifyValues(input.data);
      const bytes =
        tagsResult.data.tags.length > 0 ? fillTags(zip, values) : appendDataRow(zip, values);
      if (bytes.error) return bytes;
      return ok({ bytes: bytes.data });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to generate the spreadsheet from the template.", cause));
    }
  }

  // Writes placeholders into the workbook without filling it. Annotating always
  // moves a workbook to tag mode (ADR-039 precedence), so callers must recompute
  // spreadsheetTemplateMode from the returned bytes rather than reuse the mode
  // detected before annotation.
  annotate(input: AnnotateInput): Result<AnnotateOutput> {
    if (input.edits.length === 0) {
      return ok({ bytes: input.templateBytes, appliedCount: 0, unmatched: [] });
    }

    try {
      const zip = new PizZip(input.templateBytes);
      const sharedStrings = readSharedStrings(zip);
      const seenCounts = new Map<string, number>();
      const applied = new Set<TemplateAnnotationEdit>();

      for (const part of allSheetParts(zip)) {
        const file = zip.file(part);
        if (!file) continue;
        zip.file(
          part,
          annotateSheet(file.asText(), sharedStrings, input.edits, seenCounts, applied),
        );
      }

      return ok({
        bytes: zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer,
        appliedCount: applied.size,
        unmatched: input.edits.filter((edit) => !applied.has(edit)),
      });
    } catch (cause) {
      return err(
        domainError(
          "INFRA_FAILURE",
          "Failed to write annotations into the spreadsheet template.",
          cause,
        ),
      );
    }
  }

  // Decides the authoring mode from the bytes alone (ADR-039 precedence: any tag
  // ⇒ tags). Used by the upload route to persist spreadsheetTemplateMode.
  detectMode(input: ExtractTagsInput): Result<{ mode: "tags" | "header" }> {
    const tagsResult = this.extractTags(input);
    if (tagsResult.error) return tagsResult;
    return ok({ mode: tagsResult.data.tags.length > 0 ? "tags" : "header" });
  }

  private collectRawTags(zip: PizZip): Result<ExtractTagsOutput> {
    const sharedStrings = readSharedStrings(zip);
    const tags: string[] = [];
    // TAG_PATTERN is non-greedy, so a mistyped brace runs forward into the next
    // well-formed tag and both collapse into one nonsense field. Checked here
    // rather than per caller so the upload route and the renderer agree.
    const issues: DomainErrorDetail[] = [];
    let scannedCells = 0;

    for (const part of allSheetParts(zip)) {
      const grid = readSheetGrid(zip.file(part)?.asText() ?? "", sharedStrings);
      const scanned = this.scanGrid(grid, scannedCells);
      if (scanned.error) return scanned;
      scannedCells = scanned.data.scannedCells;
      tags.push(...scanned.data.tags);
      issues.push(...scanned.data.issues);
    }

    if (issues.length > 0) {
      return err(domainError("VALIDATION_FAILED", headlineFor(issues), undefined, issues));
    }
    return ok({ tags });
  }

  private scanGrid(
    grid: SheetGrid,
    startingCellCount: number,
  ): Result<{ tags: string[]; issues: DomainErrorDetail[]; scannedCells: number }> {
    const tags: string[] = [];
    const issues: DomainErrorDetail[] = [];
    let scannedCells = startingCellCount;

    for (const [rowIndex, row] of grid.rows.entries()) {
      for (const [columnIndex, value] of row.entries()) {
        if (value === undefined) continue;
        scannedCells += 1;
        if (scannedCells > MAX_TEMPLATE_CELLS) {
          return err(
            domainError(
              "VALIDATION_FAILED",
              `This workbook is too large to scan for tags (over ${MAX_TEMPLATE_CELLS.toLocaleString()} cells). Upload a smaller template.`,
            ),
          );
        }
        const reference = `${columnLetter(columnIndex)}${rowIndex + 1}`;
        issues.push(...tagSyntaxIssues(value, ` (in cell ${reference})`));
        for (const match of value.matchAll(TAG_PATTERN)) {
          tags.push((match[1] ?? "").trim());
        }
      }
    }

    return ok({ tags, issues, scannedCells });
  }

  // No per-tag details means the failure is structural — a group nested in a
  // section, an unclosed block — which parseTemplateFields already words better
  // than a list of individually valid tags could.
  private tagContentFailure(rawTags: string[], fallback: DomainError): DomainError {
    const details = detailsFromTagContent(rawTags);
    if (details.length === 0) return fallback;
    return domainError("VALIDATION_FAILED", headlineFor(details), undefined, details);
  }

  private headerFields(zip: PizZip): Result<ExtractFieldsOutput> {
    const sharedStrings = readSharedStrings(zip);
    const firstPart = allSheetParts(zip)[0];
    const grid = firstPart ? readSheetGrid(zip.file(firstPart)?.asText() ?? "", sharedStrings) : { rows: [] };
    const headerRow = grid.rows.find((row) => row.some((value) => value && value.trim()));

    if (!headerRow) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          "This spreadsheet has no {{ tag }} placeholders and no header row. Add a header row of column names, or tags like {{ client_name }}, then re-upload.",
        ),
      );
    }

    const fields: TemplateField[] = [];
    const seenKeys = new Set<string>();
    for (const heading of headerRow) {
      const label = (heading ?? "").trim();
      if (!label) continue;
      const key = deriveFieldKey(label);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      fields.push({ key, label, type: "text", optional: false, raw: label });
    }

    if (fields.length === 0) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          "This spreadsheet's header row has no usable column names. Add at least one heading, then re-upload.",
        ),
      );
    }
    return ok({ fields });
  }
}

const INVALID_XLSX_MESSAGE =
  "Failed to parse the spreadsheet. Ensure the file is a valid .xlsx and any {{ tags }} are correctly formed.";

// ── value coercion ───────────────────────────────────────────────────────────

// A spreadsheet cell holds text, so the render data (which may carry booleans for
// section gates or arrays for groups) is flattened to strings. Groups have no
// natural single-cell representation and are dropped.
const stringifyValues = (
  data: Record<string, string | boolean | Array<Record<string, string>>>,
): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") values[key] = value;
    else if (typeof value === "boolean") values[key] = value ? "Yes" : "No";
  }
  return values;
};

// ── tag-mode fill ────────────────────────────────────────────────────────────

const fillTags = (zip: PizZip, values: Record<string, string>): Result<Buffer> => {
  const sharedStrings = readSharedStrings(zip);
  for (const part of allSheetParts(zip)) {
    const file = zip.file(part);
    if (!file) continue;
    zip.file(part, fillSheetTags(file.asText(), sharedStrings, values));
  }
  return ok(zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer);
};

// Rewrites only the cells whose resolved text contains a tag, converting each to
// an inline string with the tag replaced. Every other cell — and the shared
// strings table — is left byte-for-byte intact so styling and untouched values
// survive (ADR-039: values guaranteed, styling best-effort).
const fillSheetTags = (
  xml: string,
  sharedStrings: string[],
  values: Record<string, string>,
): string =>
  xml.replace(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g, (whole, attributes: string, tail: string, body: string) => {
    if (tail === "/>") return whole;
    const resolved = resolveCellText(attributes, body ?? "", sharedStrings);
    if (!resolved.includes("{{")) return whole;
    const filled = resolved.replace(TAG_PATTERN, (_match, inner: string) => {
      const key = templateFieldKey(inner.trim());
      return values[key] ?? "";
    });
    return inlineStringCell(attributes, filled);
  });

// Preserves the reference and style (s="…") attributes, forces the cell to an
// inline string, and drops any stale type (t="…") so the new body is read back
// correctly.
const inlineStringCell = (attributes: string, text: string): string => {
  const withoutType = attributes.replace(/\s+t="[^"]*"/g, "");
  return `<c${withoutType} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
};

// ── annotation ───────────────────────────────────────────────────────────────

// Rewrites only the cells an edit lands in, converting each to an inline string.
// Every other cell keeps its bytes, so styling and untouched values survive on
// the same terms as tag-mode fill.
const annotateSheet = (
  xml: string,
  sharedStrings: string[],
  edits: TemplateAnnotationEdit[],
  seenCounts: Map<string, number>,
  applied: Set<TemplateAnnotationEdit>,
): string =>
  xml.replace(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g, (whole, attributes: string, tail: string, body: string) => {
    if (tail === "/>") return whole;
    const resolved = resolveCellText(attributes, body ?? "", sharedStrings);
    if (!resolved) return whole;

    const annotated = annotateCellText(resolved, edits, seenCounts, applied);
    if (annotated === resolved) return whole;
    return inlineStringCell(attributes, annotated);
  });

// Applies every edit that lands in one cell, advancing the workbook-wide
// occurrence counter for each match — including matches no edit targets, since
// skipping them would shift the indices the caller derived from the text.
const annotateCellText = (
  text: string,
  edits: TemplateAnnotationEdit[],
  seenCounts: Map<string, number>,
  applied: Set<TemplateAnnotationEdit>,
): string => {
  interface Span {
    start: number;
    end: number;
    replacement: string;
    edit: TemplateAnnotationEdit;
  }

  const spans: Span[] = [];

  for (const find of new Set(edits.map((edit) => edit.find))) {
    if (!find) continue;
    let searchFrom = 0;
    for (;;) {
      const start = text.indexOf(find, searchFrom);
      if (start < 0) break;
      const index = seenCounts.get(find) ?? 0;
      seenCounts.set(find, index + 1);
      searchFrom = start + find.length;

      const edit = edits.find(
        (candidate) =>
          candidate.find === find && candidate.occurrence === index && !applied.has(candidate),
      );
      if (edit) {
        spans.push({ start, end: start + find.length, replacement: edit.replacement, edit });
      }
    }
  }

  // Applied right to left so each splice leaves the earlier offsets valid.
  const ordered = spans.sort((a, b) => b.start - a.start);
  let result = text;
  let lastStart = text.length;
  for (const span of ordered) {
    if (span.end > lastStart) continue;
    result = result.slice(0, span.start) + span.replacement + result.slice(span.end);
    lastStart = span.start;
    applied.add(span.edit);
  }
  return result;
};

// ── header-mode append ───────────────────────────────────────────────────────

const appendDataRow = (zip: PizZip, values: Record<string, string>): Result<Buffer> => {
  const part = allSheetParts(zip)[0];
  const file = part ? zip.file(part) : null;
  if (!part || !file) {
    return err(domainError("INFRA_FAILURE", "The spreadsheet has no worksheet to write into."));
  }

  const sharedStrings = readSharedStrings(zip);
  const xml = file.asText();
  const grid = readSheetGrid(xml, sharedStrings);
  const headerRowNumber = grid.rows.findIndex((row) => row.some((value) => value && value.trim())) + 1;
  if (headerRowNumber === 0) {
    return err(domainError("INFRA_FAILURE", "The spreadsheet has no header row to write beneath."));
  }

  const headings = grid.rows[headerRowNumber - 1] ?? [];
  const dataRowNumber = headerRowNumber + 1;
  const dataCells = headings
    .map((heading, columnIndex) => {
      const label = (heading ?? "").trim();
      if (!label) return "";
      const value = values[deriveFieldKey(label)] ?? "";
      return inlineStringCell(` r="${columnLetter(columnIndex)}${dataRowNumber}"`, value);
    })
    .join("");
  const dataRow = `<row r="${dataRowNumber}">${dataCells}</row>`;

  return ok(writeAppendedRow(zip, part, xml, headerRowNumber, dataRow));
};

// Inserts the new row directly after the header, shifting every subsequent row
// (and its cell references) down by one so the workbook stays well-formed.
const writeAppendedRow = (
  zip: PizZip,
  part: string,
  xml: string,
  headerRowNumber: number,
  dataRow: string,
): Buffer => {
  const shifted = xml.replace(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/, (whole, inner: string) => {
    const rows = [...inner.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>|<row\b[^>]*\/>/g)].map((match) => match[0]);
    const rebuilt: string[] = [];
    for (const row of rows) {
      const rowNumber = Number(/\br="(\d+)"/.exec(row)?.[1] ?? "0");
      rebuilt.push(rowNumber > headerRowNumber ? shiftRow(row, 1) : row);
    }
    const insertAt = rebuilt.findIndex((row) => Number(/\br="(\d+)"/.exec(row)?.[1] ?? "0") > headerRowNumber);
    if (insertAt < 0) rebuilt.push(dataRow);
    else rebuilt.splice(insertAt, 0, dataRow);
    return whole.replace(inner, rebuilt.join(""));
  });
  zip.file(part, shifted);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
};

const shiftRow = (rowXml: string, delta: number): string =>
  rowXml
    .replace(/(<row\b[^>]*\br=")(\d+)(")/, (_match, prefix: string, number: string, suffix: string) => `${prefix}${Number(number) + delta}${suffix}`)
    .replace(/(\br="[A-Z]+)(\d+)(")/g, (_match, prefix: string, number: string, suffix: string) => `${prefix}${Number(number) + delta}${suffix}`);

// ── xlsx reading (PizZip, mirrors the HR SpreadsheetParser) ───────────────────

const resolveCellText = (attributes: string, body: string, sharedStrings: string[]): string => {
  const type = /t="([^"]+)"/.exec(attributes)?.[1] ?? null;
  if (type === "s") {
    const index = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
    return sharedStrings[index] ?? "";
  }
  if (type === "inlineStr") {
    const texts = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
    return texts.map((match) => unescapeXml(match[1] ?? "")).join("");
  }
  if (type === "str") {
    return unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
  }
  return unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
};

const readSheetGrid = (xml: string, sharedStrings: string[]): SheetGrid => {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(/\br="(\d+)"/.exec(rowMatch[1] ?? "")?.[1] ?? `${rows.length + 1}`);
    const byColumn: string[] = [];
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1] ?? "";
      const body = cellMatch[2] === "/>" ? "" : cellMatch[3] ?? "";
      const reference = /r="([A-Z]+)\d+"/.exec(attributes)?.[1] ?? null;
      const columnIndex = reference ? columnToIndex(reference) : byColumn.length;
      byColumn[columnIndex] = resolveCellText(attributes, body, sharedStrings);
    }
    rows[rowNumber - 1] = byColumn;
  }
  return { rows };
};

const readSharedStrings = (zip: PizZip): string[] => {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];
  const xml = file.asText();
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
    const texts = [...(match[1] ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
    return texts.map((textMatch) => unescapeXml(textMatch[1] ?? "")).join("");
  });
};

// Worksheet parts in workbook (tab) order; falls back to a part-name sort when
// the workbook/rels are absent, matching the HR parser's resolution.
const allSheetParts = (zip: PizZip): string[] => {
  const ordered = orderedSheetParts(zip);
  if (ordered.length > 0) return ordered;
  return Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort();
};

const orderedSheetParts = (zip: PizZip): string[] => {
  const workbookXml = zip.file("xl/workbook.xml")?.asText();
  const relsXml = zip.file("xl/_rels/workbook.xml.rels")?.asText();
  if (!workbookXml || !relsXml) return [];

  const relationships = new Map<string, string>();
  for (const relationship of relsXml.matchAll(/<Relationship\b([^>]*)>/g)) {
    const attributes = relationship[1] ?? "";
    const id = /Id="([^"]+)"/.exec(attributes)?.[1];
    const target = /Target="([^"]+)"/.exec(attributes)?.[1];
    if (id && target) relationships.set(id, `xl/${target.replace(/^\//, "").replace(/^xl\//, "")}`);
  }

  const parts: string[] = [];
  for (const sheet of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const relationshipId = /r:id="([^"]+)"/.exec(sheet[0])?.[1];
    const part = relationshipId ? relationships.get(relationshipId) : undefined;
    if (part && zip.file(part)) parts.push(part);
  }
  return parts;
};

// ── small helpers ────────────────────────────────────────────────────────────

const columnToIndex = (reference: string): number => {
  let index = 0;
  for (const char of reference) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
};

const columnLetter = (index: number): string => {
  let result = "";
  let n = index;
  do {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
};

const capText = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  const sliced = text.slice(0, maxChars);
  const lastSpace = sliced.lastIndexOf(" ");
  return lastSpace > 0 ? sliced.slice(0, lastSpace + 1) : sliced;
};

const escapeXml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const unescapeXml = (value: string): string =>
  value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
