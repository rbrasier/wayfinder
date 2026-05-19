import type { MessageRole } from "./conversation";

export type { MessageRole };

export interface SessionDocument {
  filename: string;
  storagePath: string;
  summary: string | null;
  generatedAt: string;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  confidence: number | null;
  stepNodeId: string | null;
  document: SessionDocument | null;
  createdAt: Date;
}

export interface NewSessionMessage {
  sessionId: string;
  role: MessageRole;
  content: string;
  confidence?: number | null;
  stepNodeId?: string | null;
  document?: SessionDocument | null;
}
