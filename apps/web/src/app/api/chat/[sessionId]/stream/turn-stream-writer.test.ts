import { describe, expect, it } from "vitest";
import { formatDataStreamPart } from "ai";
import type { DataStreamWriter } from "ai";
import { DataStreamTurnWriter } from "./turn-stream-writer";

// A minimal DataStreamWriter double capturing the exact parts and annotations
// the adapter emits, so the wire format the client depends on is pinned.
const fakeStream = () => {
  const parts: string[] = [];
  const annotations: unknown[] = [];
  const stream = {
    write: (part: string) => {
      parts.push(part);
    },
    writeMessageAnnotation: (value: unknown) => {
      annotations.push(value);
    },
  } as unknown as DataStreamWriter;
  return { stream, parts, annotations };
};

describe("DataStreamTurnWriter", () => {
  it("writeText emits a text data-stream part", () => {
    const { stream, parts } = fakeStream();
    new DataStreamTurnWriter(stream).writeText("Hello world");

    expect(parts).toEqual([formatDataStreamPart("text", "Hello world")]);
  });

  it("endBubble emits a finish_step boundary so the next text opens a new bubble", () => {
    const { stream, parts } = fakeStream();
    new DataStreamTurnWriter(stream).endBubble();

    expect(parts).toEqual([
      formatDataStreamPart("finish_step", { finishReason: "stop", isContinued: false }),
    ]);
  });

  it("writeAnnotation forwards the typed annotation verbatim", () => {
    const { stream, annotations } = fakeStream();
    const writer = new DataStreamTurnWriter(stream);
    writer.writeAnnotation({ type: "confidence", score: 72 });
    writer.writeAnnotation({ type: "cross-checking", active: true, documents: ["policy"] });
    writer.writeAnnotation({ type: "generating-document", active: false });

    expect(annotations).toEqual([
      { type: "confidence", score: 72 },
      { type: "cross-checking", active: true, documents: ["policy"] },
      { type: "generating-document", active: false },
    ]);
  });
});
