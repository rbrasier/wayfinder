import type { TemplateField } from "../entities/template-field";
import type { Result } from "../result";

export interface ExtractTagsInput {
  templateBytes: Buffer;
}

export interface ExtractTagsOutput {
  tags: string[];
}

export interface ExtractFieldsInput {
  templateBytes: Buffer;
}

export interface ExtractFieldsOutput {
  fields: TemplateField[];
}

export interface GenerateInput {
  templateBytes: Buffer;
  // String values fill {{placeholder}} tags; boolean values gate optional
  // {{#section}} … {{/section}} blocks; an array of records feeds a repeating
  // {{#group (repeat)}} … {{/group}} block (docxtemplater's paragraphLoop
  // renders the inner tags once per item).
  data: Record<string, string | boolean | Array<Record<string, string>>>;
}

export interface GenerateOutput {
  // The rendered document bytes. Format-neutral: docx or xlsx depending on the
  // generator behind the port (ADR-039), so it is not named for either.
  bytes: Buffer;
}

export interface ExtractFullTextInput {
  templateBytes: Buffer;
}

export interface ExtractFullTextOutput {
  text: string;
}

export interface IDocumentGenerator {
  extractTags(input: ExtractTagsInput): Result<ExtractTagsOutput>;
  extractFields(input: ExtractFieldsInput): Result<ExtractFieldsOutput>;
  extractFullText(input: ExtractFullTextInput): Result<ExtractFullTextOutput>;
  generate(input: GenerateInput): Result<GenerateOutput>;
}
