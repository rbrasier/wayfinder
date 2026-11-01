import {
  ok,
  type ILanguageModel,
  type INodeExecutor,
  type NodeExecutionInput,
  type NodeExecutionOutput,
  type Result,
} from "@wayfinder/domain";
import { documentDataSchema } from "@wayfinder/shared";

// Dev/test executor for INodeExecutor. Completes synchronously so an auto node
// can be exercised without a running n8n instance. When the node declares
// response fields, it asks the configured chat model to invent a plausible
// response shaped by those fields; otherwise it echoes the gathered request
// fields back.
export class MockNodeExecutor implements INodeExecutor {
  constructor(private readonly languageModel: ILanguageModel) {}

  async execute(input: NodeExecutionInput): Promise<Result<NodeExecutionOutput>> {
    const responseFields = input.responseFields ?? [];
    if (responseFields.length === 0) {
      return ok({
        status: "completed",
        data: {
          nodeId: input.nodeId,
          sessionId: input.sessionId,
          correlationId: input.correlationId,
          ...input.fields,
        },
        message: `Node ${input.nodeId} executed (mock).`,
      });
    }

    const keys = responseFields.map((field) => field.key);
    const descriptions = responseFields
      .map((field) => `- ${field.key} (${field.type})${field.optional ? " [optional]" : ""}: ${field.label}`)
      .join("\n");

    const generated = await this.languageModel.generateObject<Record<string, string>>({
      purpose: "mockNodeResponse",
      system: input.instruction,
      prompt: [
        `You are mocking the JSON response of an automated workflow step for testing.`,
        `Return a JSON object with exactly these keys: ${JSON.stringify(keys)}.`,
        `Invent plausible, internally-consistent values consistent with the request fields below.`,
        `\nResponse fields:\n${descriptions}`,
        `\nRequest fields sent to the step:\n${JSON.stringify(input.fields)}`,
      ].join("\n"),
      schema: documentDataSchema,
    });
    if (generated.error) return generated;

    return ok({
      status: "completed",
      data: generated.data.object,
      message: `Node ${input.nodeId} executed (mock, AI-generated).`,
    });
  }
}
