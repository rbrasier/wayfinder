import {
  ok,
  type BuildBranchChoicePromptInput,
  type BuildSystemPromptInput,
  type ISessionAgent,
  type Result,
} from "@rbrasier/domain";

export class FlowSessionGraph implements ISessionAgent {
  buildSystemPrompt(input: BuildSystemPromptInput): Result<string> {
    const { nodeConfig, contextDocs, gatheredContext, workflowName, organisationName, expertRole } = input;

    const roleBlock = buildRoleBlock(expertRole, organisationName, workflowName);

    const gatheredBlock = gatheredContext.trim()
      ? `\n  <gathered_context>\n    ${gatheredContext.trim()}\n    You may ask nuanced follow-up questions to clarify or deepen anything captured here if it would help complete this step more accurately.\n  </gathered_context>`
      : "";

    const docsBlock = contextDocs.length > 0
      ? `\n  <reference_documents>\n${contextDocs.map((d) => `    - ${d.filename}`).join("\n")}\n    Consult these when the user's question touches on policy or process.\n  </reference_documents>`
      : "";

    const contextSection = gatheredBlock || docsBlock
      ? `\n<context>${gatheredBlock}${docsBlock}\n</context>`
      : "";

    const templateBlock =
      nodeConfig.outputType === "generate_document" && nodeConfig.documentTemplateMarkdown
        ? `\n\n  <document_template>\n    This step produces a document. Your goal is to gather all information needed to fully complete the following template:\n    ${nodeConfig.documentTemplateMarkdown}\n  </document_template>`
        : "";

    const prompt = `${roleBlock}

<instructions>
  ${nodeConfig.aiInstruction}
</instructions>${contextSection}

<goal>
  Your goal is to gather enough information to reach 90% confidence or above that the <completion_criteria> below has been fully satisfied. Continue asking questions until you are confident the criteria has been met.

  <completion_criteria>${nodeConfig.doneWhen}</completion_criteria>${templateBlock}
</goal>

<constraints>
  - Ask one question at a time — wait for the answer before continuing
  - Be plain-spoken — no jargon or technical terms
  - Do not discuss future steps
  - Do not re-ask for information already in gathered_context unless clarification would meaningfully improve the output
  - If the user goes off-topic, gently redirect them back to this step
</constraints>

<output>
  Respond only with valid JSON in this exact structure — no prose outside it:

  {
    "response": "Your conversational reply to the user",
    "rationale": "Why you are asking this or why the step is complete",
    "stepCompleteConfidence": 0-100,
    "contextGathered": [
      { "key": "descriptive label", "value": "what the user provided" }
    ]
  }
</output>`;

    return ok(prompt);
  }

  buildBranchChoicePrompt(input: BuildBranchChoicePromptInput): Result<string> {
    const branchList = input.branchNodes
      .map((n) => `- ${n.id} (${n.name})`)
      .join("\n");

    const prompt = `Based on the conversation below, select the most appropriate next step.

Available branches:
${branchList}

Return only: { "branchChoice": "<nodeId>" }`;

    return ok(prompt);
  }
}

const buildRoleBlock = (
  expertRole: string | null,
  organisationName: string | null,
  workflowName: string,
): string => {
  const expertSentences = expertRole
    ? `You are a world-class ${expertRole} with over 20 years of experience${organisationName ? ` at ${organisationName}` : ""}. You understand its processes, culture, and requirements intimately. `
    : "";
  return `<role>
  ${expertSentences}You are currently helping a colleague complete the "${workflowName}" workflow, guiding them through it step by step. Stay focused on this step only — do not anticipate future steps.
</role>`;
};
