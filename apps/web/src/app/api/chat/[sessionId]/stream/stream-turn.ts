import { formatDataStreamPart, streamObject, type LanguageModel } from "ai";
import type { z } from "zod";

export interface StreamTurnWriter {
  write: (data: ReturnType<typeof formatDataStreamPart<"text">>) => void;
}

export interface StreamTurnInput<Schema extends z.ZodTypeAny> {
  model: LanguageModel;
  schema: Schema;
  system: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  writer: StreamTurnWriter;
}

export async function streamTurn<Schema extends z.ZodTypeAny>(
  input: StreamTurnInput<Schema>,
): Promise<z.infer<Schema>> {
  let streamError: unknown = null;

  const turnStream = streamObject({
    model: input.model,
    schema: input.schema,
    system: input.system,
    messages: input.messages,
    // partialObjectStream silently swallows "error" chunks and `object` never
    // resolves on failure, so without this callback the route would hang
    // forever on any model/network/schema failure.
    onError: ({ error }) => {
      streamError = error;
    },
  });

  let previousResponseLength = 0;
  for await (const partial of turnStream.partialObjectStream) {
    const currentResponse =
      typeof (partial as { response?: unknown }).response === "string"
        ? ((partial as { response: string }).response)
        : "";
    if (currentResponse.length > previousResponseLength) {
      const newChars = currentResponse.slice(previousResponseLength);
      input.writer.write(formatDataStreamPart("text", newChars));
      previousResponseLength = currentResponse.length;
    }
  }

  if (streamError) throw streamError;

  return turnStream.object as Promise<z.infer<Schema>>;
}
