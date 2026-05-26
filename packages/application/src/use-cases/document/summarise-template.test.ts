import { describe, it, expect, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type { ILanguageModel } from "@rbrasier/domain";
import { SummariseTemplate } from "./summarise-template";

const makeLanguageModel = (
  overrides: Partial<ILanguageModel> = {},
): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi.fn().mockResolvedValue(
    ok({
      object: { structuredContent: "# RFT\n\nProject: {{project_title}}\nBackground: {{background}}" },
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        systemTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    }),
  ),
  streamText: vi.fn(),
  streamObject: vi.fn(),
  ...overrides,
});

describe("SummariseTemplate", () => {
  it("returns the structured content produced by the language model", async () => {
    const languageModel = makeLanguageModel();
    const useCase = new SummariseTemplate(languageModel);

    const result = await useCase.execute({
      fullExtractedText: "Long template text with many paragraphs and {{project_title}} placeholder.",
      tags: ["project_title", "background"],
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.structuredContent).toContain("{{project_title}}");
  });

  it("passes the tags into the language model prompt", async () => {
    const languageModel = makeLanguageModel();
    const useCase = new SummariseTemplate(languageModel);

    await useCase.execute({
      fullExtractedText: "Template body",
      tags: ["project_title", "budget"],
    });

    const generateObjectMock = languageModel.generateObject as ReturnType<typeof vi.fn>;
    const callArgs = generateObjectMock.mock.calls[0][0];
    expect(callArgs.prompt).toContain("project_title");
    expect(callArgs.prompt).toContain("budget");
  });

  it("uses 'template-summarisation' as the call purpose for usage tracking", async () => {
    const languageModel = makeLanguageModel();
    const useCase = new SummariseTemplate(languageModel);

    await useCase.execute({
      fullExtractedText: "Template body",
      tags: [],
    });

    const generateObjectMock = languageModel.generateObject as ReturnType<typeof vi.fn>;
    expect(generateObjectMock.mock.calls[0][0].purpose).toBe("template-summarisation");
  });

  it("falls back to the full extracted text when the language model returns an error", async () => {
    const languageModel = makeLanguageModel({
      generateObject: vi.fn().mockResolvedValue(
        err(domainError("INFRA_FAILURE", "AI model failed.")),
      ),
    });
    const useCase = new SummariseTemplate(languageModel);

    const fullText = "Some template prose with {{tag}}";
    const result = await useCase.execute({
      fullExtractedText: fullText,
      tags: ["tag"],
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.structuredContent).toBe(fullText);
  });

  it("falls back to the full extracted text when the language model returns empty content", async () => {
    const languageModel = makeLanguageModel({
      generateObject: vi.fn().mockResolvedValue(
        ok({
          object: { structuredContent: "" },
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            systemTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
        }),
      ),
    });
    const useCase = new SummariseTemplate(languageModel);

    const fullText = "Template fallback content";
    const result = await useCase.execute({
      fullExtractedText: fullText,
      tags: [],
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.structuredContent).toBe(fullText);
  });
});
