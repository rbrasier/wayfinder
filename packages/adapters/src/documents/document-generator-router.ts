import PizZip from "pizzip";
import type {
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
} from "@rbrasier/domain";

// Dispatches each IDocumentGenerator call to the docx or xlsx renderer by
// sniffing the template bytes (ADR-039). Detection is on the file's own zip
// contents — an .xlsx has an xl/ part, a .docx has word/document.xml — so it is
// deterministic and always agrees with the format recorded at upload. Callers
// that need the format for storage (MIME type, extension) read it from the node
// config; the renderer itself is selected here so no consumer re-implements it.
export class DocumentGeneratorRouter implements IDocumentGenerator {
  constructor(
    private readonly docxGenerator: IDocumentGenerator,
    private readonly xlsxGenerator: IDocumentGenerator,
  ) {}

  extractTags(input: ExtractTagsInput): Result<ExtractTagsOutput> {
    return this.select(input.templateBytes).extractTags(input);
  }

  extractFields(input: ExtractFieldsInput): Result<ExtractFieldsOutput> {
    return this.select(input.templateBytes).extractFields(input);
  }

  extractFullText(input: ExtractFullTextInput): Result<ExtractFullTextOutput> {
    return this.select(input.templateBytes).extractFullText(input);
  }

  generate(input: GenerateInput): Result<GenerateOutput> {
    return this.select(input.templateBytes).generate(input);
  }

  private select(templateBytes: Buffer): IDocumentGenerator {
    return isXlsx(templateBytes) ? this.xlsxGenerator : this.docxGenerator;
  }
}

// A bad zip falls through to docx, whose parser surfaces the clear "not a valid
// .docx" error rather than the router guessing.
const isXlsx = (templateBytes: Buffer): boolean => {
  try {
    const files = Object.keys(new PizZip(templateBytes).files);
    return files.some((name) => name === "xl/workbook.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  } catch {
    return false;
  }
};
