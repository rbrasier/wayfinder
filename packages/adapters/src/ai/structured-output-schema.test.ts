import { describe, expect, it } from "vitest";
import { zodSchema } from "ai";
import { turnResponseSchema } from "@rbrasier/shared";

// generateObject/streamObject hand the provider the JSON Schema `ai` derives
// from our zod schemas. ai@4 derived an empty one from zod 4 schemas, silently
// stripping every structured call of its output contract; this pins that the
// chat turn's contract — fields, required set, descriptions — survives.
describe("structured output schema for a chat turn", () => {
  it("reaches the provider with every field, its type and its description", async () => {
    const jsonSchema = (await zodSchema(turnResponseSchema).jsonSchema) as {
      type: string;
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { type: string; description: string }>;
    };

    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.required.sort()).toEqual(
      ["contextGathered", "rationale", "response", "stepCompleteConfidence"].sort(),
    );
    expect(jsonSchema.additionalProperties).toBe(false);
    expect(jsonSchema.properties.response).toEqual({
      type: "string",
      description: "Conversational reply to the user",
    });
  });

  // The confidence is rounded and clamped by a transform; the model must still
  // be asked for a plain number, not an unrepresentable transform output.
  it("asks for the input side of a transformed field", async () => {
    const jsonSchema = (await zodSchema(turnResponseSchema).jsonSchema) as {
      properties: Record<string, { type: string; description: string }>;
    };

    expect(jsonSchema.properties.stepCompleteConfidence).toEqual({
      type: "number",
      description: "Confidence 0-100 that completion criteria are fully met",
    });
  });
});
