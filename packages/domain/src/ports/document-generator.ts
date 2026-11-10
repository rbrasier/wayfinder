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
  // PNG images placed above the text of the same-keyed signature slot — a
  // drawn signature (ADR-067 §2). A generator that cannot place images (xlsx)
  // ignores them and renders the text alone.
  images?: Record<string, Buffer>;
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

// One occurrence-addressed text substitution inside a template. The same shape
// covers all three authoring cases: re-annotating an existing "{{ tag }}",
// replacing a filled example's literal value with a new placeholder, and
// inserting a placeholder beside a label in an empty template.
export interface TemplateAnnotationEdit {
  // The exact source text to replace, as it reads in the extracted document text.
  find: string;
  // Zero-based index among identical `find` occurrences, so a supplier name
  // appearing three times is addressed as three separate edits.
  occurrence: number;
  // The literal text to put in its place, braces included where a placeholder is
  // intended — e.g. "{{ Supplier Name (text) (maxlen: 80) }}".
  replacement: string;
}

export interface AnnotateInput {
  templateBytes: Buffer;
  edits: TemplateAnnotationEdit[];
}

export interface AnnotateOutput {
  bytes: Buffer;
  appliedCount: number;
  // Edits whose `find` text was absent at the requested occurrence. Returned
  // rather than dropped: writing a template that silently missed half its
  // placeholders is worse than telling the author which ones did not land.
  unmatched: TemplateAnnotationEdit[];
}

export interface IDocumentGenerator {
  extractTags(input: ExtractTagsInput): Result<ExtractTagsOutput>;
  extractFields(input: ExtractFieldsInput): Result<ExtractFieldsOutput>;
  extractFullText(input: ExtractFullTextInput): Result<ExtractFullTextOutput>;
  generate(input: GenerateInput): Result<GenerateOutput>;
  // Writes placeholders into a template without rendering it. The uploaded
  // original is never mutated — the annotated bytes are a new document.
  annotate(input: AnnotateInput): Result<AnnotateOutput>;
}
