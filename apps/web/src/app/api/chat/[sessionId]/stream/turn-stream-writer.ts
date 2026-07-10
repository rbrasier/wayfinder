import { formatDataStreamPart, type DataStreamWriter } from "ai";
import type { JSONValue } from "ai";
import type { TurnStreamAnnotation, TurnStreamWriter } from "@rbrasier/domain";

// The `ai`-SDK adapter for the TurnStreamWriter port: the single place that maps
// the port's semantic operations onto the Vercel data-stream wire format. Keeping
// this the only file in the stream path that touches `formatDataStreamPart` lets
// the turn orchestration depend on the framework-free port instead.
export class DataStreamTurnWriter implements TurnStreamWriter {
  constructor(private readonly stream: DataStreamWriter) {}

  writeText(text: string): void {
    this.stream.write(formatDataStreamPart("text", text));
  }

  endBubble(): void {
    this.stream.write(formatDataStreamPart("finish_step", { finishReason: "stop", isContinued: false }));
  }

  writeAnnotation(annotation: TurnStreamAnnotation): void {
    this.stream.writeMessageAnnotation(annotation as unknown as JSONValue);
  }
}
