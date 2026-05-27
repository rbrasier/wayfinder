import { beforeEach, describe, expect, it, vi } from "vitest";

const { openaiFactory, anthropicFactory, mistralFactory } = vi.hoisted(() => ({
  openaiFactory: vi.fn((modelId: string) => ({ provider: "openai", modelId })),
  anthropicFactory: vi.fn((modelId: string) => ({ provider: "anthropic", modelId })),
  mistralFactory: vi.fn((modelId: string) => ({ provider: "mistral", modelId })),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => openaiFactory),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => anthropicFactory),
}));

vi.mock("@ai-sdk/mistral", () => ({
  createMistral: vi.fn(() => mistralFactory),
}));

import { createOpenAI } from "@ai-sdk/openai";
import { defaultModelFor, resolveModel } from "./providers";

describe("defaultModelFor", () => {
  it("returns gpt-4o-mini for openai", () => {
    expect(defaultModelFor("openai")).toBe("gpt-4o-mini");
  });
});

describe("resolveModel — openai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses gpt-4o-mini as the default model when no model is given", () => {
    resolveModel("openai", undefined, "sk-test");

    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-test" });
    expect(openaiFactory).toHaveBeenCalledWith("gpt-4o-mini");
  });

  it("respects the model argument when provided", () => {
    resolveModel("openai", "gpt-4o", "sk-test");

    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-test" });
    expect(openaiFactory).toHaveBeenCalledWith("gpt-4o");
  });

  it("passes an empty options object when apiKey is null", () => {
    resolveModel("openai", "gpt-4o", null);

    expect(createOpenAI).toHaveBeenCalledWith({});
  });

  it("passes an empty options object when apiKey is undefined", () => {
    resolveModel("openai", "gpt-4o");

    expect(createOpenAI).toHaveBeenCalledWith({});
  });

  it("returns the LanguageModel produced by the openai factory", () => {
    const result = resolveModel("openai", "gpt-4o-mini", "sk-test");

    expect(result).toEqual({ provider: "openai", modelId: "gpt-4o-mini" });
  });
});
