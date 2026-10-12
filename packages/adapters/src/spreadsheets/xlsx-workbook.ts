import PizZip from "pizzip";

// XLSX primitives shared by the HR spreadsheet importer and extraction intake.
// Read with PizZip (already a dependency) and regular expressions over the
// sheet XML; no SheetJS-style library is pulled in.

export interface WorkbookSheet {
  name: string;
  hidden: boolean;
  // The worksheet part inside the package, e.g. "xl/worksheets/sheet2.xml".
  part: string;
}

// Relationship targets are relative to the xl/ directory (e.g. "worksheets/
// sheet2.xml") but may arrive absolute ("/xl/worksheets/sheet2.xml").
export const normaliseSheetPath = (target: string): string =>
  `xl/${target.replace(/^\//, "").replace(/^xl\//, "")}`;

const attribute = (attributes: string, name: string): string | null =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1] ?? null;

const readRelationshipTargets = (zip: PizZip): Map<string, string> => {
  const targets = new Map<string, string>();
  const relsXml = zip.file("xl/_rels/workbook.xml.rels")?.asText();
  if (!relsXml) return targets;
  for (const relationship of relsXml.matchAll(/<Relationship\b([^>]*)>/g)) {
    const attributes = relationship[1] ?? "";
    const id = attribute(attributes, "Id");
    const target = attribute(attributes, "Target");
    if (id && target) targets.set(id, normaliseSheetPath(target));
  }
  return targets;
};

// Every sheet in tab order — the order of <sheet> elements in xl/workbook.xml,
// resolved through the workbook relationships to its part. The part name
// (sheet1.xml, sheet2.xml…) does not track tab order once tabs are reordered.
export const listSheets = (zip: PizZip): WorkbookSheet[] => {
  const workbookXml = zip.file("xl/workbook.xml")?.asText();
  if (!workbookXml) return [];
  const targets = readRelationshipTargets(zip);
  const sheets: WorkbookSheet[] = [];
  for (const sheet of workbookXml.matchAll(/<sheet\b([^>]*)>/g)) {
    const attributes = sheet[1] ?? "";
    const part = targets.get(attribute(attributes, "r:id") ?? "");
    if (!part) continue;
    const state = attribute(attributes, "state");
    sheets.push({
      name: unescapeXml(attribute(attributes, "name") ?? ""),
      hidden: state === "hidden" || state === "veryHidden",
      part,
    });
  }
  return sheets;
};

export const readSharedStrings = (zip: PizZip): string[] => {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];
  const xml = file.asText();
  const items = [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)];
  return items.map((match) => {
    const inner = match[1] ?? "";
    const texts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
    return texts.map((textMatch) => unescapeXml(textMatch[1] ?? "")).join("");
  });
};

// A sheet as a grid of strings, gaps between referenced cells filled with "".
export const readSheet = (xml: string, sharedStrings: string[]): string[][] => {
  const rowMatches = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)];
  return rowMatches.map((rowMatch) => {
    // A styled empty cell is self-closing (<c r="B2" s="1"/>); matching it as an
    // open tag would swallow the next cell's value into this column.
    const cellMatches = [
      ...(rowMatch[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g),
    ];
    const byColumn: string[] = [];
    for (const cellMatch of cellMatches) {
      const attributes = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const reference = /r="([A-Z]+)\d+"/.exec(attributes)?.[1] ?? null;
      const columnIndex = reference ? columnToIndex(reference) : byColumn.length;
      byColumn[columnIndex] = readCellValue(attributes, body, sharedStrings);
    }
    for (let index = 0; index < byColumn.length; index += 1) {
      if (byColumn[index] === undefined) byColumn[index] = "";
    }
    return byColumn;
  });
};

const readCellValue = (attributes: string, body: string, sharedStrings: string[]): string => {
  const type = /t="([^"]+)"/.exec(attributes)?.[1] ?? null;
  if (type === "s") {
    const index = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
    return sharedStrings[index] ?? "";
  }
  if (type === "inlineStr") {
    const texts = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)];
    return texts.map((match) => unescapeXml(match[1] ?? "")).join("");
  }
  return unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
};

const columnToIndex = (reference: string): number => {
  let index = 0;
  for (const char of reference) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
};

export const unescapeXml = (value: string): string =>
  value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
