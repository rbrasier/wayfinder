import type { ExtractionStatus } from "./flow";

// A file the end user uploaded during a flow session. Its extracted text becomes
// session-scoped context injected into the AI system prompt on every subsequent
// turn — the session-level counterpart to FlowContextDoc.
export interface SessionUpload {
  id: string;
  sessionId: string;
  // The user message this file accompanied, if any. Informational only — context
  // injection is session-scoped, so association is optional.
  messageId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  extractedText: string | null;
  extractionStatus: ExtractionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSessionUpload {
  sessionId: string;
  messageId?: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  extractedText: string | null;
  extractionStatus: ExtractionStatus;
}

export const sumSessionUploadChars = (
  uploads: { extractedText: string | null }[],
): number => uploads.reduce((total, upload) => total + (upload.extractedText?.length ?? 0), 0);
