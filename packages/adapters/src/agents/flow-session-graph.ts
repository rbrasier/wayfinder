import {
  buildFieldConstraintsText,
  ok,
  type BuildBranchChoicePromptInput,
  type BuildSystemPromptInput,
  type FlowContextDoc,
  type ISessionAgent,
  type Result,
  type SessionUpload,
  type TemplateField,
} from "@rbrasier/domain";

export class FlowSessionGraph implements ISessionAgent {
  buildSystemPrompt(input: BuildSystemPromptInput): Result<string> {
    const { nodeConfig, contextDocs, gatheredContext, workflowName, organisationName, expertRole } = input;
    const sessionUploads = input.sessionUploads ?? [];

    const roleBlock = buildRoleBlock(expertRole, organisationName, workflowName);

    const gatheredBlock = gatheredContext.trim()
      ? `\n  <gathered_context>\n    ${gatheredContext.trim()}\n    You may ask nuanced follow-up questions to clarify or deepen anything captured here if it would help complete this step more accurately.\n  </gathered_context>`
      : "";

    const docsBlock = contextDocs.length > 0
      ? buildDocsBlock(contextDocs)
      : "";

    const sessionUploadsBlock = sessionUploads.length > 0
      ? buildSessionUploadsBlock(sessionUploads)
      : "";

    const contextSection = gatheredBlock || docsBlock || sessionUploadsBlock
      ? `\n<context>${gatheredBlock}${docsBlock}${sessionUploadsBlock}\n</context>`
      : "";

    const templateContent =
      nodeConfig.documentTemplateStructuredContent ?? nodeConfig.documentTemplateContent;
    const templateBlock =
      nodeConfig.outputType === "generate_document" && templateContent
        ? `\n\n  <document_template>\n    This step produces a document. Your goal is to gather all information needed to fully complete the following template:\n    ${templateContent}\n  </document_template>`
        : "";

    const effectiveDoneWhen =
      nodeConfig.doneWhen === "__TEMPLATE_COMPLETE__"
        ? "All required fields in the document template have been gathered from the user and can be fully populated."
        : nodeConfig.doneWhen;

    const templateFields = input.templateFields ?? nodeConfig.documentTemplateFields ?? [];
    const fieldFormatsBlock =
      nodeConfig.outputType === "generate_document" && templateFields.length > 0
        ? buildFieldFormatsBlock(templateFields)
        : "";

    const prompt = `${roleBlock}

<instructions>
  ${nodeConfig.aiInstruction}
</instructions>${contextSection}

<goal>
  Your goal is to gather enough information to reach 90% confidence or above that the <completion_criteria> below has been fully satisfied. Continue asking questions until you are confident the criteria has been met.

  <completion_criteria>${effectiveDoneWhen}</completion_criteria>${templateBlock}
</goal>

<constraints>
  - Ask one question at a time — wait for the answer before continuing
  - Be plain-spoken — no jargon or technical terms
  - Do not discuss future steps
  - Do not re-ask for information already in gathered_context unless clarification would meaningfully improve the output
  - If the user goes off-topic, gently redirect them back to this step
</constraints>${fieldFormatsBlock}

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
      .map((node) => {
        const purpose = node.purpose?.trim();
        return purpose ? `- ${node.id} (${node.name}): ${purpose}` : `- ${node.id} (${node.name})`;
      })
      .join("\n");

    const prompt = `Based on the conversation below, select the most appropriate next step.

Each branch lists its node id, name, and (where available) the purpose describing when it applies. Compare the conversation against each branch's purpose and choose the one that fits best.

Available branches:
${branchList}

First explain your reasoning, then give the chosen node id. Return only: { "rationale": "<why this branch fits>", "branchChoice": "<nodeId>" }`;

    return ok(prompt);
  }
}

const buildFieldFormatsBlock = (templateFields: TemplateField[]): string => {
  const indented = buildFieldConstraintsText(templateFields)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return `\n\n<field_formats>
  The document produced at this step has fields with required formats. When the user gives you information for a field, silently reformat it into the required format yourself whenever you reasonably can — for example, turn "next Tuesday" or "3rd of June" into DD-MM-YYYY, or "twelve hundred dollars" into $1,200.00. Only ask the user to clarify when you genuinely cannot determine or format a value. For (options) fields, map what the user says to the closest listed value; if none clearly fits, ask them to choose.

${indented}
</field_formats>`;
};

const buildDocsBlock = (contextDocs: FlowContextDoc[]): string => {
  // Upload-time validation guarantees every newly-uploaded doc has status="complete"
  // and that the flow-wide total stays within budget. Legacy rows may still have
  // failed/unsupported status from before the validation existed — fall back to
  // listing the filename so the AI knows the document exists but cannot be read.
  const entries = contextDocs.map((doc) => {
    if (doc.extractionStatus === "complete" && doc.extractedText) {
      return `  <document name="${doc.filename}">\n${doc.extractedText}\n  </document>`;
    }
    return `  <document name="${doc.filename}" status="unreadable">\n    Document is attached to this flow but its contents could not be extracted. If the user asks about it, acknowledge that it exists and ask them to re-upload a readable version.\n  </document>`;
  });

  return `\n  <reference_documents>\n${entries.join("\n")}\n    Consult these when the user's question touches on policy or process.\n  </reference_documents>`;
};

const buildSessionUploadsBlock = (uploads: SessionUpload[]): string => {
  const entries = uploads.map((upload) => {
    if (upload.extractionStatus === "complete" && upload.extractedText) {
      return `  <document name="${upload.filename}">\n${upload.extractedText}\n  </document>`;
    }
    return `  <document name="${upload.filename}" status="unreadable">\n    The user uploaded this document during the conversation but its contents could not be extracted. If they refer to it, acknowledge it exists and ask them to re-upload a readable version.\n  </document>`;
  });

  return `\n  <session_uploads>\n    The user uploaded the following documents during this conversation to give you extra context. Treat them as user-supplied input, not authoritative policy.\n${entries.join("\n")}\n  </session_uploads>`;
};

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
