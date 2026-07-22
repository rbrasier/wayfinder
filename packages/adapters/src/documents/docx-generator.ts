import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import InspectModule from "docxtemplater/js/inspect-module.js";
import { domainError, err, ok, parseTemplateFields, templateFieldKey } from "@rbrasier/domain";
import type { IDocumentGenerator, ExtractTagsInput, ExtractTagsOutput, ExtractFieldsInput, ExtractFieldsOutput, ExtractFullTextInput, ExtractFullTextOutput, GenerateInput, GenerateOutput } from "@rbrasier/domain";
import type { Result } from "@rbrasier/domain";

interface RunInfo {
  xml: string;
  rPrXml: string;
  text: string;
  startIndex: number;
  endIndex: number;
  xmlStart: number;
  xmlEnd: number;
}

export class DocxGenerator implements IDocumentGenerator {
  extractTags(input: ExtractTagsInput): Result<ExtractTagsOutput> {
    try {
      const processedBytes = this.preprocessTemplate(input.templateBytes);
      const zip = new PizZip(processedBytes);
      const inspectModule = new InspectModule();
      new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "{{", end: "}}" },
        modules: [inspectModule],
      });
      const tagMap = inspectModule.getAllTags() as Record<string, unknown>;
      const tags = Object.keys(tagMap);
      return ok({ tags });
    } catch (cause) {
      return err(domainError("VALIDATION_FAILED", "Failed to parse DOCX template. Ensure the file is a valid .docx and all {{tags}} are correctly formed.", cause));
    }
  }

  extractFields(input: ExtractFieldsInput): Result<ExtractFieldsOutput> {
    try {
      const rawTags = this.collectRawTags(input.templateBytes);
      const parsed = parseTemplateFields(rawTags);
      if (parsed.error) return parsed;
      return ok({ fields: parsed.data });
    } catch (cause) {
      return err(domainError("VALIDATION_FAILED", "Failed to parse DOCX template. Ensure the file is a valid .docx and all {{tags}} are correctly formed.", cause));
    }
  }

  extractFullText(input: ExtractFullTextInput): Result<ExtractFullTextOutput> {
    try {
      const zip = new PizZip(input.templateBytes);
      const file = zip.file("word/document.xml");
      if (!file) {
        return err(domainError("VALIDATION_FAILED", "word/document.xml not found in DOCX."));
      }
      const xml = file.asText();
      const paragraphTexts = this.extractParagraphTexts(xml);
      const fullText = paragraphTexts.filter((p) => p.trim()).join("\n");
      const capped = this.capText(fullText, 32_768);
      return ok({ text: capped });
    } catch (cause) {
      return err(domainError("VALIDATION_FAILED", "Failed to extract text from DOCX.", cause));
    }
  }

  generate(input: GenerateInput): Result<GenerateOutput> {
    try {
      const processedBytes = this.preprocessTemplate(input.templateBytes);
      const zip = new PizZip(processedBytes);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "{{", end: "}}" },
      });
      doc.render(input.data);
      const bytes = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
      return ok({ bytes });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to generate DOCX from template.", cause));
    }
  }

  private preprocessTemplate(docxBytes: Buffer): Buffer {
    const zip = new PizZip(docxBytes);

    const filenames = Object.keys(zip.files).filter(
      (name) => name === "word/document.xml" || /^word\/(header|footer)\d*\.xml$/.test(name),
    );

    for (const filename of filenames) {
      const file = zip.file(filename);
      if (!file) continue;
      zip.file(filename, this.fixTemplateXml(file.asText()));
    }

    return zip.generate({ type: "nodebuffer" }) as Buffer;
  }

  // Collects the raw inner text of every {{ tag }} across the document body,
  // headers and footers — reconstructing run-split tags — so annotations survive
  // for field parsing (preprocessTemplate would otherwise normalise them away).
  private collectRawTags(docxBytes: Buffer): string[] {
    const zip = new PizZip(docxBytes);
    const filenames = Object.keys(zip.files).filter(
      (name) => name === "word/document.xml" || /^word\/(header|footer)\d*\.xml$/.test(name),
    );

    const rawTags: string[] = [];
    for (const filename of filenames) {
      const file = zip.file(filename);
      if (!file) continue;
      const paragraphs = file.asText().match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
      for (const paragraph of paragraphs) {
        const fullText = this.extractRuns(paragraph)
          .map((run) => run.text)
          .join("");
        for (const match of fullText.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
          rawTags.push((match[1] ?? "").trim());
        }
      }
    }
    return rawTags;
  }

  private fixTemplateXml(xml: string): string {
    return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (paragraph) =>
      this.fixParagraphTags(paragraph),
    );
  }

  private fixParagraphTags(paragraph: string): string {
    const runs = this.extractRuns(paragraph);
    if (runs.length === 0) return paragraph;

    const fullText = runs.map((run) => run.text).join("");
    if (!fullText.includes("{{") || !fullText.includes("}}")) return paragraph;

    const tagPattern = /\{\{([\s\S]*?)\}\}/g;
    const tagMatches = [...fullText.matchAll(tagPattern)];
    if (tagMatches.length === 0) return paragraph;

    const replacements = tagMatches.map((match) => {
      const matchStart = match.index ?? 0;
      return {
        start: matchStart,
        end: matchStart + match[0].length,
        normalizedTag: `{{${this.normalizeTagName(match[1] ?? "")}}}`,
        rPrXml: this.rPrXmlForPosition(runs, matchStart),
      };
    });

    const newRuns = this.buildNewRuns(runs, replacements, fullText);
    return this.replaceParagraphRuns(paragraph, runs, newRuns);
  }

  private extractRuns(paragraph: string): RunInfo[] {
    const runs: RunInfo[] = [];
    let textOffset = 0;
    const runPattern = /<w:r[ >][\s\S]*?<\/w:r>/g;
    let match;

    while ((match = runPattern.exec(paragraph)) !== null) {
      const runXml = match[0];
      const rPrMatch = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
      const text = this.extractRunText(runXml);

      runs.push({
        xml: runXml,
        rPrXml: rPrMatch ? rPrMatch[0] : "",
        text,
        startIndex: textOffset,
        endIndex: textOffset + text.length,
        xmlStart: match.index,
        xmlEnd: match.index + runXml.length,
      });
      textOffset += text.length;
    }

    return runs;
  }

  private extractRunText(runXml: string): string {
    const matches = [...runXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)];
    return matches.map((match) => match[1]).join("");
  }

  private rPrXmlForPosition(runs: RunInfo[], position: number): string {
    const run = runs.find((run) => run.startIndex <= position && run.endIndex > position);
    return run?.rPrXml ?? "";
  }

  private buildNewRuns(
    runs: RunInfo[],
    replacements: Array<{ start: number; end: number; normalizedTag: string; rPrXml: string }>,
    fullText: string,
  ): string[] {
    const newRuns: string[] = [];
    let position = 0;

    for (const replacement of replacements) {
      if (position < replacement.start) {
        const runsInRange = runs.filter(
          (run) => run.endIndex > position && run.startIndex < replacement.start,
        );
        for (const run of runsInRange) {
          const sliceStart = Math.max(run.startIndex, position);
          const sliceEnd = Math.min(run.endIndex, replacement.start);
          const text = run.text.slice(sliceStart - run.startIndex, sliceEnd - run.startIndex);
          if (text) newRuns.push(this.buildRun(run.rPrXml, text));
        }
      }

      newRuns.push(this.buildRun(replacement.rPrXml, replacement.normalizedTag));
      position = replacement.end;
    }

    if (position < fullText.length) {
      const runsInRange = runs.filter((run) => run.endIndex > position);
      for (const run of runsInRange) {
        const sliceStart = Math.max(run.startIndex, position);
        const text = run.text.slice(sliceStart - run.startIndex);
        if (text) newRuns.push(this.buildRun(run.rPrXml, text));
      }
    }

    return newRuns;
  }

  private replaceParagraphRuns(
    paragraph: string,
    originalRuns: RunInfo[],
    newRuns: string[],
  ): string {
    const firstRun = originalRuns.at(0);
    const lastRun = originalRuns.at(-1);
    if (!firstRun || !lastRun) return paragraph;
    return (
      paragraph.slice(0, firstRun.xmlStart) +
      newRuns.join("") +
      paragraph.slice(lastRun.xmlEnd)
    );
  }

  private buildRun(rPrXml: string, text: string): string {
    const escapedText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const spacePreserve = text.startsWith(" ") || text.endsWith(" ") ? ' xml:space="preserve"' : "";
    return `<w:r>${rPrXml}<w:t${spacePreserve}>${escapedText}</w:t></w:r>`;
  }

  private extractParagraphTexts(xml: string): string[] {
    const paragraphs: string[] = [];
    const paragraphPattern = /<w:p[ >][\s\S]*?<\/w:p>/g;
    let match;
    while ((match = paragraphPattern.exec(xml)) !== null) {
      const textMatches = [...match[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)];
      paragraphs.push(textMatches.map((m) => m[1]).join(""));
    }
    return paragraphs;
  }

  private capText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const sliced = text.slice(0, maxChars);
    const lastSpace = sliced.lastIndexOf(" ");
    return lastSpace > 0 ? sliced.slice(0, lastSpace + 1) : sliced;
  }

  // Render key must match the parsed field key: annotations are stripped so
  // {{ Employee Email (email) }} and the AI-supplied "employee_email" align.
  // Section markers (#/^ open, / close) keep their sigil so docxtemplater still
  // recognises the block; only the name portion is normalised.
  private normalizeTagName(description: string): string {
    const trimmed = description.trim();
    const sigilMatch = trimmed.match(/^([#/^])\s*([\s\S]*)$/);
    if (sigilMatch) {
      return `${sigilMatch[1]}${templateFieldKey(sigilMatch[2] ?? "")}`;
    }
    return templateFieldKey(description);
  }
}
