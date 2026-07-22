import type { ConversationalNodeConfig } from "@rbrasier/domain";

export type DocumentTemplateFormat = "docx" | "xlsx";

// Storage content types per template format. A generated file rides the same
// document-card/download path regardless of format (ADR-039), so the only
// format-specific choices are the stored MIME type and the file extension.
export const DOCUMENT_MIME: Record<DocumentTemplateFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// A config with no format is a pre-xlsx docx flow (ADR-039 back-compat).
export const templateFormat = (config: ConversationalNodeConfig): DocumentTemplateFormat =>
  config.documentTemplateFormat === "xlsx" ? "xlsx" : "docx";
