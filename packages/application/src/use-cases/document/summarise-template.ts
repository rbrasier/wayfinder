import {
  ok,
  type ILanguageModel,
  type Result,
} from "@rbrasier/domain";
import { templateStructureSchema } from "@rbrasier/shared";

export interface SummariseTemplateInput {
  fullExtractedText: string;
  tags: string[];
}

export interface SummariseTemplateOutput {
  structuredContent: string;
}

const buildPrompt = (fullExtractedText: string, tags: string[]): string => {
  const tagsList = tags.length > 0 ? tags.map((t) => `{{${t}}}`).join(", ") : "(none)";
  return [
    "You are reducing a document template to its structural skeleton so an AI can",
    "see what fields a downstream conversation must gather, without paying token",
    "cost for the template's prose body.",
    "",
    "Rules:",
    "- Preserve every placeholder tag verbatim. The known tags in this template are: " + tagsList,
    "- Preserve all headings, section titles, and field labels (the short text that",
    "  introduces each placeholder).",
    "- Drop long prose paragraphs that do not contain a placeholder or label.",
    "- Keep table structure (rows / columns / cell labels) where placeholders live in tables.",
    "- Do not invent new placeholders. Do not rename existing placeholders.",
    "- The output is for AI consumption — readability matters more than formatting fidelity.",
    "",
    "Template:",
    "---",
    fullExtractedText,
    "---",
    "",
    "Return JSON with a single key `structuredContent` containing the reduced template.",
  ].join("\n");
};

export class SummariseTemplate {
  constructor(private readonly languageModel: ILanguageModel) {}

  async execute(input: SummariseTemplateInput): Promise<Result<SummariseTemplateOutput>> {
    const aiResult = await this.languageModel.generateObject<{ structuredContent: string }>({
      purpose: "template-summarisation",
      prompt: buildPrompt(input.fullExtractedText, input.tags),
      schema: templateStructureSchema,
      temperature: 0.1,
    });

    if (aiResult.error) {
      return ok({ structuredContent: input.fullExtractedText });
    }

    const structuredContent = aiResult.data.object.structuredContent.trim();
    if (structuredContent.length === 0) {
      return ok({ structuredContent: input.fullExtractedText });
    }

    return ok({ structuredContent });
  }
}
