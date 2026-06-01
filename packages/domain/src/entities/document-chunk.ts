// A single embedded slice of a source document. Chunks are the unit of
// retrieval: at inference time the most relevant chunks (by cosine similarity
// to the user's message) are injected into the system prompt instead of the
// whole document. Exactly one of flowId / sessionId is non-null per chunk —
// flow-scoped sources (context docs, templates) carry flowId; session uploads
// carry sessionId.
export type ChunkSourceType = "flow_context_doc" | "session_upload" | "template";

export interface DocumentChunk {
  id: string;
  flowId: string | null;
  sessionId: string | null;
  sourceType: ChunkSourceType;
  storagePath: string;
  filename: string;
  chunkIndex: number;
  chunkText: string;
  embedding: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface NewDocumentChunk {
  flowId: string | null;
  sessionId: string | null;
  sourceType: ChunkSourceType;
  storagePath: string;
  filename: string;
  chunkIndex: number;
  chunkText: string;
  embedding: number[];
}

// What retrieval returns: the chunk text plus the metadata needed to attribute
// it in the prompt and the similarity score used to rank and threshold results.
export interface RetrievedChunk {
  filename: string;
  chunkIndex: number;
  chunkText: string;
  sourceType: ChunkSourceType;
  similarity: number;
}
