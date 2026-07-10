// Typed annotations a streaming chat turn attaches to its message. The adapter
// maps each to the client's wire format, so the turn orchestration stays
// framework-agnostic and can live in the application layer without importing an
// AI/streaming SDK.
export type TurnStreamAnnotation =
  | { readonly type: "confidence"; readonly score: number }
  | {
      readonly type: "cross-checking";
      readonly active: boolean;
      readonly documents?: readonly string[];
    }
  | { readonly type: "generating-document"; readonly active: boolean };

// Outbound port for writing a streaming chat turn back to the client. Semantic
// operations only — no wire-format or SDK type leaks through it — so turn
// orchestration depends on this interface rather than the Vercel data stream
// writer directly.
export interface TurnStreamWriter {
  // Append streamed assistant text to the current message bubble.
  writeText(text: string): void;
  // Close the current bubble so the next `writeText` opens a new one on the
  // client. Without it, text written across a hold/pass boundary concatenates
  // into one bubble that the persisted view then appears to rewrite.
  endBubble(): void;
  // Attach a typed annotation (confidence, cross-check status, doc-gen status)
  // to the streamed message.
  writeAnnotation(annotation: TurnStreamAnnotation): void;
}
