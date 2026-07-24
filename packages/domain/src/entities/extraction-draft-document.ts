// An input document staged against an extraction flow's draft, before any run
// is started (progressive upload — ADR-033). Persisted so the author's intake
// survives leaving the editor and seeds the run when a sample is started.
export interface ExtractionDraftDocument {
  id: string;
  flowId: string;
  filename: string;
  // Folder path preserved from the upload (a zip or a directory drop), so the
  // tree renders sub-folders and the grouping pass can use folder criteria.
  treePath: string;
  storageKey: string;
  mimeType: string;
}

export interface NewExtractionDraftDocument {
  filename: string;
  treePath: string;
  storageKey: string;
  mimeType: string;
}
