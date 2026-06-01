// Defaults for the admin-configurable session-upload limits. If no value is
// stored in admin settings, these apply. Mirrors the flow-level CONTEXT_DOCS_*
// limits but scoped to a single session's user uploads.
export const SESSION_UPLOADS_DEFAULT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
export const SESSION_UPLOADS_DEFAULT_TOTAL_BUDGET_CHARS = 65_536;

// Bounded by what IDocumentExtractor can read — not admin-editable.
export const SESSION_UPLOADS_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
] as const;

export type SessionUploadsAllowedMimeType =
  (typeof SESSION_UPLOADS_ALLOWED_MIME_TYPES)[number];
