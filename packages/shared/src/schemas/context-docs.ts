export const CONTEXT_DOCS_TOTAL_BUDGET_CHARS = 65_536;
export const CONTEXT_DOCS_WARNING_THRESHOLD_CHARS = 32_768;

export const CONTEXT_DOCS_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
] as const;

export type ContextDocsAllowedMimeType = (typeof CONTEXT_DOCS_ALLOWED_MIME_TYPES)[number];

export const CONTEXT_DOCS_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
