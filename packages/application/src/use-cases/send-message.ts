import {
  type IConversationRepository,
  type ILanguageModel,
  type Result,
  domainError,
  err,
} from "@rbrasier/domain";
import { sampleResponseSchema, type SampleResponse } from "@rbrasier/shared";

export interface SendMessageInput {
  readonly prompt: string;
  readonly userId?: string | null;
  readonly conversationId?: string;
}

export interface SendMessageOutput {
  readonly conversationId: string;
  readonly partialObjectStream: AsyncIterable<Partial<SampleResponse>>;
  readonly object: Promise<SampleResponse>;
}

const SAMPLE_SYSTEM_PROMPT = `You are a helpful assistant.

Respond as JSON matching the provided schema:
- "response": a clear, helpful natural-language answer
- "confidence": an integer 1..100 reflecting how sure you are
- "rationale": one short sentence explaining your confidence`;

export class SendMessage {
  constructor(
    private readonly llm: ILanguageModel,
    private readonly conversations: IConversationRepository,
  ) {}

  async execute(input: SendMessageInput): Promise<Result<SendMessageOutput>> {
    if (!input.prompt.trim()) {
      return err(domainError("VALIDATION_FAILED", "prompt cannot be empty."));
    }

    let conversationId = input.conversationId;
    if (!conversationId) {
      const created = await this.conversations.create({
        userId: input.userId ?? null,
        title: input.prompt.slice(0, 80),
      });
      if (created.error) return created;
      conversationId = created.data.id;
    }

    const userMsg = await this.conversations.appendMessage({
      conversationId,
      role: "user",
      content: input.prompt,
    });
    if (userMsg.error) return userMsg;

    const stream = await this.llm.streamObject<SampleResponse>({
      purpose: "chat",
      userId: input.userId,
      schema: sampleResponseSchema,
      system: SAMPLE_SYSTEM_PROMPT,
      prompt: input.prompt,
    });
    if (stream.error) return stream;

    const finalObject = stream.data.object.then(async (obj) => {
      await this.conversations.appendMessage({
        conversationId: conversationId as string,
        role: "assistant",
        content: obj.response,
        metadata: { confidence: obj.confidence, rationale: obj.rationale },
      });
      return obj;
    });

    return {
      data: {
        conversationId,
        partialObjectStream: stream.data.partialObjectStream,
        object: finalObject,
      },
    };
  }
}
