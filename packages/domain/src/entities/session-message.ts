import type { MessageRole } from "./conversation";

export type { MessageRole };

// One before/after value pair changed within a single manual edit.
export interface DocumentFieldChange {
  key: string;
  previousValue: string;
  newValue: string;
}

// A durable metadata-history entry for one manual field edit. Survives later
// regeneration (which clears the live edited stamps but never the history).
export interface DocumentEdit {
  editedAt: string;
  editedByUserId: string | null;
  storagePath: string;
  changes: DocumentFieldChange[];
}

export interface SessionDocument {
  filename: string;
  storagePath: string;
  summary: string | null;
  generatedAt: string;
  // Live edit stamps — set on a manual edit, cleared by regeneration.
  editedAt?: string | null;
  editedByUserId?: string | null;
  // Append-only audit of manual edits; preserved across regeneration.
  editHistory?: DocumentEdit[];
}

export interface DocumentGenerationConfidence {
  guidanceAlignmentConfidence: number;
  guidanceAlignmentRationale: string;
  criteriaAlignmentConfidence: number;
  criteriaAlignmentRationale: string;
}

export interface AiTurnPayload {
  response: string;
  rationale: string;
  stepCompleteConfidence: number;
  contextGathered: { key: string; value: string }[];
  documentGenerationConfidence?: DocumentGenerationConfidence | null;
}

export type DocumentStatus = "pending" | "complete" | "failed";

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  // The human who sent this message. Null for assistant/system messages and
  // for legacy rows created before collaborative sessions existed.
  senderUserId: string | null;
  confidence: number | null;
  stepNodeId: string | null;
  document: SessionDocument | null;
  documentStatus: DocumentStatus | null;
  aiPayload: AiTurnPayload | null;
  createdAt: Date;
}

export interface NewSessionMessage {
  sessionId: string;
  role: MessageRole;
  content: string;
  senderUserId?: string | null;
  confidence?: number | null;
  stepNodeId?: string | null;
  document?: SessionDocument | null;
  documentStatus?: DocumentStatus | null;
  aiPayload?: AiTurnPayload | null;
}
