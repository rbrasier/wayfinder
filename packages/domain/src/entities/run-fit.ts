// The pre-run size check shown before a Synthesise run starts (issue #335).
// Only `blocking` stops a run; everything else is a heads-up the author can act
// on or ignore, because an oversized document is now read in parts, not failed.
export interface DocumentSplitEstimate {
  documentId: string;
  filename: string;
  // Roughly how many model calls the document will take.
  parts: number;
}

export interface RunFitEstimate {
  // The flow's instructions and context material alone leave no room for any
  // document text in one call — nothing can be extracted until they shrink.
  blocking: boolean;
  documentsToSplit: DocumentSplitEstimate[];
  // Staged before text length was recorded, or unreadable at upload.
  unknownSizeCount: number;
  // The flow's context material is longer than the extraction budget allows.
  contextTruncated: boolean;
  // Set only when a summary is configured and will not read every record.
  summaryCoverage: { read: number; total: number } | null;
}
