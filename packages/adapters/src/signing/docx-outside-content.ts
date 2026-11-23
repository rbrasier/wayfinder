import PizZip from "pizzip";
import { domainError, err, ok, type Result } from "@wayfinder/domain";

const RELATIONSHIP = /<Relationship\b[^>]*>/g;
const EXTERNAL = /\bTargetMode\s*=\s*["']External["']/i;
const TYPE = /\bType\s*=\s*["']([^"']*)["']/i;

// A hyperlink is only text the reader may click; nothing fetches it when the
// document is converted. Every other outside relationship (linked images,
// linked objects, remote templates, frames) is fetched on load.
const isHarmless = (kind: string): boolean => kind === "hyperlink";

// Lists the kinds of outside content a .docx would make its converter fetch.
// Bytes that are not a .docx at all are an error: LibreOffice opens a file as
// whatever its content is, so HTML or RTF under a .docx name would bring its
// own remote references.
export const findOutsideContent = (docxBytes: Buffer): Result<string[]> => {
  let zip: PizZip;
  try {
    zip = new PizZip(docxBytes);
  } catch (cause) {
    return err(domainError("VALIDATION_FAILED", "The document to convert is not a .docx file.", cause));
  }
  if (!zip.file("word/document.xml")) {
    return err(domainError("VALIDATION_FAILED", "The document to convert is not a .docx file."));
  }

  const kinds = new Set<string>();
  for (const part of zip.file(/(^|\/)_rels\/[^/]+\.rels$/)) {
    for (const relationship of part.asText().match(RELATIONSHIP) ?? []) {
      if (!EXTERNAL.test(relationship)) continue;
      const kind = TYPE.exec(relationship)?.[1]?.split("/").pop() ?? "unknown";
      if (!isHarmless(kind)) kinds.add(kind);
    }
  }
  return ok([...kinds].sort());
};
