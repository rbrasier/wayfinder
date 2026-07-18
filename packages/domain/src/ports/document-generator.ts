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

export interface GenerateDocxInput {
  templateBytes: Buffer;
  // String values fill {{placeholder}} tags; boolean values gate optional
  // {{#section}} … {{/section}} blocks; an array of records feeds a repeating
  // {{#group (repeat)}} … {{/group}} block (docxtemplater's paragraphLoop
  // renders the inner tags once per item).
  data: Record<string, string | boolean | Array<Record<string, string>>>;
}

export interface GenerateDocxOutput {
  docxBytes: Buffer;
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
  generate(input: GenerateDocxInput): Result<GenerateDocxOutput>;
}
