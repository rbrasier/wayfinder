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
  data: Record<string, string>;
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
