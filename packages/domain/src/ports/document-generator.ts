import type { Result } from "../result";

export interface ExtractTagsInput {
  templateBytes: Buffer;
}

export interface ExtractTagsOutput {
  tags: string[];
}

export interface GenerateDocxInput {
  templateBytes: Buffer;
  data: Record<string, string>;
}

export interface GenerateDocxOutput {
  docxBytes: Buffer;
}

export interface IDocumentGenerator {
  extractTags(input: ExtractTagsInput): Result<ExtractTagsOutput>;
  generate(input: GenerateDocxInput): Result<GenerateDocxOutput>;
}
