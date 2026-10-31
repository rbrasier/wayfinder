import { describe, expect, it } from "vitest";
import type { UIMessageStreamWriter } from "ai";
import type { ChatUiMessage } from "@/lib/chat/ui-messages";
import { UiMessageStreamTurnWriter } from "./turn-stream-writer";

// A minimal UIMessageStreamWriter double capturing the exact chunks the adapter
// emits, so the wire format the client depends on is pinned.
const fakeStream = () => {
  const chunks: unknown[] = [];
  const stream = {
    write: (chunk: unknown) => {
      chunks.push(chunk);
    },
  } as unknown as UIMessageStreamWriter<ChatUiMessage>;
  return { stream, chunks };
};

const sequentialIds = () => {
  let next = 0;
  return () => `text-${++next}`;
};

describe("UiMessageStreamTurnWriter", () => {
  it("opens a text part on the first write and streams later text into it", () => {
    const { stream, chunks } = fakeStream();
    const writer = new UiMessageStreamTurnWriter(stream, sequentialIds());

    writer.writeText("Hello");
    writer.writeText(" world");

    expect(chunks).toEqual([
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Hello" },
      { type: "text-delta", id: "text-1", delta: " world" },
    ]);
  });

  it("endBubble closes the text part so the next text opens a new bubble", () => {
    const { stream, chunks } = fakeStream();
    const writer = new UiMessageStreamTurnWriter(stream, sequentialIds());

    writer.writeText("First.");
    writer.endBubble();
    writer.writeText("Second.");

    expect(chunks).toEqual([
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "First." },
      { type: "text-end", id: "text-1" },
      { type: "text-start", id: "text-2" },
      { type: "text-delta", id: "text-2", delta: "Second." },
    ]);
  });

  it("endBubble with no open bubble writes nothing", () => {
    const { stream, chunks } = fakeStream();
    const writer = new UiMessageStreamTurnWriter(stream, sequentialIds());

    writer.endBubble();
    writer.writeText("Only.");
    writer.endBubble();
    writer.endBubble();

    expect(chunks).toEqual([
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Only." },
      { type: "text-end", id: "text-1" },
    ]);
  });

  it("writeAnnotation sends the typed annotation verbatim as a data part", () => {
    const { stream, chunks } = fakeStream();
    const writer = new UiMessageStreamTurnWriter(stream, sequentialIds());

    writer.writeAnnotation({ type: "confidence", score: 72 });
    writer.writeAnnotation({ type: "cross-checking", active: true, documents: ["policy"] });
    writer.writeAnnotation({ type: "generating-document", active: false });

    expect(chunks).toEqual([
      { type: "data-turn-annotation", data: { type: "confidence", score: 72 } },
      { type: "data-turn-annotation", data: { type: "cross-checking", active: true, documents: ["policy"] } },
      { type: "data-turn-annotation", data: { type: "generating-document", active: false } },
    ]);
  });
});
