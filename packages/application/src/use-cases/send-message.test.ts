import { describe, it, expect } from "vitest";
import {
  type Conversation,
  type IConversationRepository,
  type ILanguageModel,
  type Message,
  type NewConversation,
  type NewMessage,
  type ProviderName,
  type Result,
  type TokenUsage,
  domainError,
  err,
  ok,
} from "@rbrasier/domain";
import { sampleResponseSchema, type SampleResponse } from "@rbrasier/shared";
import { SendMessage } from "./send-message";

const ZERO_USAGE: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

class InMemoryConversations implements IConversationRepository {
  private convos = new Map<string, Conversation>();
  private messages: Message[] = [];

  async create(input: NewConversation): Promise<Result<Conversation>> {
    const now = new Date();
    const convo: Conversation = {
      id: crypto.randomUUID(),
      userId: input.userId ?? null,
      title: input.title ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.convos.set(convo.id, convo);
    return ok(convo);
  }

  async findById(id: string): Promise<Result<Conversation | null>> {
    return ok(this.convos.get(id) ?? null);
  }

  async listForUser(userId: string): Promise<Result<Conversation[]>> {
    return ok([...this.convos.values()].filter((c) => c.userId === userId));
  }

  async appendMessage(input: NewMessage): Promise<Result<Message>> {
    const now = new Date();
    const message: Message = {
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      metadata: input.metadata ?? null,
      createdAt: now,
    };
    this.messages.push(message);
    return ok(message);
  }

  async listMessages(conversationId: string): Promise<Result<Message[]>> {
    return ok(this.messages.filter((m) => m.conversationId === conversationId));
  }
}

function makeFakeLlm(response: SampleResponse): ILanguageModel {
  async function* partialStream(): AsyncIterable<Partial<SampleResponse>> {
    yield { response: response.response };
    yield response;
  }

  return {
    provider: "anthropic" as ProviderName,
    generateObject: async () => ok({ object: response, usage: ZERO_USAGE }),
    streamText: async () =>
      ok({
        textStream: (async function* () { yield response.response; })(),
        usage: Promise.resolve(ZERO_USAGE),
      }),
    streamObject: async <T>() =>
      ok({
        partialObjectStream: partialStream() as AsyncIterable<Partial<T>>,
        object: Promise.resolve(response as T),
        usage: Promise.resolve(ZERO_USAGE),
      }),
  };
}

const fakeResponse: SampleResponse = {
  response: "The answer is 42.",
  confidence: 95,
  rationale: "Well established fact.",
};

describe("SendMessage", () => {
  it("returns VALIDATION_FAILED for an empty prompt", async () => {
    const sut = new SendMessage(makeFakeLlm(fakeResponse), new InMemoryConversations());

    const result = await sut.execute({ prompt: "   " });

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("creates a new conversation when none is provided", async () => {
    const conversations = new InMemoryConversations();
    const sut = new SendMessage(makeFakeLlm(fakeResponse), conversations);

    const result = await sut.execute({ prompt: "What is the answer?" });

    expect(result.error).toBeUndefined();
    expect(result.data?.conversationId).toBeDefined();
  });

  it("reuses an existing conversation when id is provided", async () => {
    const conversations = new InMemoryConversations();
    const created = await conversations.create({ title: "existing" });
    const existingId = created.data!.id;
    const sut = new SendMessage(makeFakeLlm(fakeResponse), conversations);

    const result = await sut.execute({
      prompt: "Follow-up question",
      conversationId: existingId,
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.conversationId).toBe(existingId);
  });

  it("returns a streaming object from the language model", async () => {
    const sut = new SendMessage(makeFakeLlm(fakeResponse), new InMemoryConversations());

    const result = await sut.execute({ prompt: "What is the answer?" });

    expect(result.error).toBeUndefined();
    const resolved = await result.data?.object;
    expect(resolved?.response).toBe("The answer is 42.");
    expect(resolved?.confidence).toBe(95);
  });

  it("propagates an LLM error as a Result error", async () => {
    const failingLlm: ILanguageModel = {
      provider: "anthropic" as ProviderName,
      generateObject: async () => err(domainError("INTERNAL_ERROR", "LLM down")),
      streamText: async () => err(domainError("INTERNAL_ERROR", "LLM down")),
      streamObject: async () => err(domainError("INTERNAL_ERROR", "LLM down")),
    };
    const sut = new SendMessage(failingLlm, new InMemoryConversations());

    const result = await sut.execute({ prompt: "What is the answer?" });

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("INTERNAL_ERROR");
  });
});

// Verify sampleResponseSchema is used correctly within send-message
describe("sampleResponseSchema", () => {
  it("validates a correct response", () => {
    const parsed = sampleResponseSchema.safeParse(fakeResponse);
    expect(parsed.success).toBe(true);
  });
});
