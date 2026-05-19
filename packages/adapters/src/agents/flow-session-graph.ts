import {
  ok,
  type BuildConfidencePromptInput,
  type BuildSystemPromptInput,
  type ISessionAgent,
  type Result,
} from "@rbrasier/domain";

export class FlowSessionGraph implements ISessionAgent {
  buildSystemPrompt(input: BuildSystemPromptInput): Result<string> {
    const { nodeConfig, contextDocs, gatheredContext } = input;

    const contextDocSection =
      contextDocs.length > 0
        ? `\n\n## Reference documents\n${contextDocs.map((d) => `- ${d.filename}`).join("\n")}\nConsult these documents when relevant to the user's questions.`
        : "";

    const gatheredSection = gatheredContext.trim()
      ? `\n\n## Context gathered so far\n${gatheredContext}`
      : "";

    const prompt = [
      "You are a helpful AI guide helping users through a structured workflow step-by-step.",
      "",
      "## Your task for this step",
      nodeConfig.aiInstruction,
      "",
      "## This step is complete when",
      nodeConfig.doneWhen,
      contextDocSection,
      gatheredSection,
      "",
      "Ask focused follow-up questions to gather the information needed. Be conversational and concise.",
      "Do not mention confidence scores or technical terms — just guide the user naturally.",
    ]
      .join("\n")
      .trim();

    return ok(prompt);
  }

  buildConfidenceSystemPrompt(input: BuildConfidencePromptInput): Result<string> {
    const { nodeConfig } = input;

    const prompt = [
      "You are evaluating a workflow conversation to assess step completion.",
      "",
      "## This step is complete when",
      nodeConfig.doneWhen,
      "",
      "Based ONLY on the conversation so far, provide a structured assessment:",
      "- confidence.score (0–100): How confident are you the done-when criteria are fully met?",
      "  Score 0 if barely any criteria are met. Score 100 if all criteria are definitively met.",
      "  Score 90+ only if you would genuinely advance to the next step right now.",
      "- confidence.readyToAdvance: true only if score >= 90 AND all criteria are satisfied.",
      "- confidence.missingInformation: Specific items still needed (empty array if nothing missing).",
      "- branchChoice: If there are multiple next steps and the conversation reveals which to take,",
      "  provide the node ID. Otherwise null.",
    ]
      .join("\n")
      .trim();

    return ok(prompt);
  }
}
