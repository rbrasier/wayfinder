import {
  buildFieldConstraintsText,
  ok,
  type BuildBranchChoicePromptInput,
  type BuildSystemPromptInput,
  type ISessionAgent,
  type PromptSessionUpload,
  type PromptUserProfile,
  type ResolvedSkill,
  type Result,
  type RetrievedChunk,
  type TemplateField,
} from "@rbrasier/domain";

export class FlowSessionGraph implements ISessionAgent {
  buildSystemPrompt(input: BuildSystemPromptInput): Result<string> {
    const { nodeConfig, gatheredContext, workflowName, organisationName, expertRole } = input;
    const retrievedChunks = input.retrievedChunks ?? [];
    const sessionUploads = input.sessionUploads ?? [];

    const roleBlock = buildRoleBlock(expertRole, organisationName, workflowName, input.userProfile ?? null);

    const globalInstructionsBlock = input.globalInstructions?.trim()
      ? `\n\n<global_instructions>\n  ${input.globalInstructions.trim()}\n</global_instructions>`
      : "";

    // Skills are author-attached reusable instructions (ADR-031), rendered in the
    // stable region of the prompt — above per-turn retrieved chunks — to preserve
    // prompt-cache hits. They steer behaviour; they do not replace <instructions>.
    const skillsBlock = buildSkillsBlock(input.resolvedSkills ?? []);

    // Attached documents are the user's own files for this request, injected in
    // full and independent of RAG, so a thin message ("here is the solution")
    // still lets the agent see them. Framed distinctly from <reference_documents>.
    const attachedDocumentsBlock = sessionUploads.length > 0
      ? buildAttachedDocumentsBlock(sessionUploads)
      : "";

    const gatheredBlock = gatheredContext.trim()
      ? `\n  <gathered_context>\n    ${gatheredContext.trim()}\n    You may ask nuanced follow-up questions to clarify or deepen anything captured here if it would help complete this step more accurately.\n  </gathered_context>`
      : "";

    const contextSection = gatheredBlock
      ? `\n<context>${gatheredBlock}\n</context>`
      : "";

    // Retrieved chunks vary per turn, so they are appended after the stable
    // structural prompt to preserve prompt-cache hits on everything above
    // (ADR-016 Decision 5).
    const referenceBlock = retrievedChunks.length > 0
      ? buildReferenceDocumentsBlock(retrievedChunks)
      : "";

    // The current date/time changes every turn, so — like the retrieved chunks —
    // it is appended after the stable structural prompt to preserve prompt-cache
    // hits on everything above.
    const currentContextBlock = input.now ? buildCurrentContextBlock(input.now) : "";

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

    const prompt = `${roleBlock}${globalInstructionsBlock}${skillsBlock}

<instructions>
  ${nodeConfig.aiInstruction}
</instructions>${contextSection}

<goal>
  Your goal is to gather enough information to reach 90% confidence or above that the <completion_criteria> below has been fully satisfied. Continue asking questions until you are confident the criteria has been met.

  <completion_criteria>${effectiveDoneWhen}</completion_criteria>${templateBlock}
</goal>

<constraints>
  - Ask one question at a time, but group closely related questions into a single message when doing so would let the user answer them together naturally — wait for the answer before continuing
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
</output>${attachedDocumentsBlock}${referenceBlock}${currentContextBlock}`;

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

const buildAttachedDocumentsBlock = (uploads: PromptSessionUpload[]): string => {
  const manifest = uploads.map((upload) => `  - ${upload.filename}`).join("\n");
  const documents = uploads
    .map((upload) => `  <document filename="${upload.filename}">\n${upload.extractedText}\n  </document>`)
    .join("\n");

  return `\n\n<attached_documents>\n  The user has attached the following document(s) to this conversation. Treat their full contents below as provided by the user for this step — do not ask them to paste what is already here.\n${manifest}\n${documents}\n</attached_documents>`;
};

const buildCurrentContextBlock = (now: Date): string => {
  // toUTCString renders an unambiguous, locale-independent form
  // ("Mon, 27 Jul 2026 09:30:00 GMT") so the model never mistakes the day and
  // month order the way a numeric date could.
  const formatted = now.toUTCString();
  return `\n\n<current_context>\n  The current date and time is ${formatted}. When the user gives a date relatively or in short form (e.g. "next Tuesday", "the 3rd", "tomorrow", "in two weeks"), interpret it relative to this current date and time.\n</current_context>`;
};

const buildReferenceDocumentsBlock = (chunks: RetrievedChunk[]): string => {
  const entries = chunks.map(
    (chunk) =>
      `  <chunk source="${chunk.filename}" chunk="${chunk.chunkIndex}">\n${chunk.chunkText}\n  </chunk>`,
  );

  return `\n\n<reference_documents>\n  The most relevant excerpts retrieved from documents attached to this workflow and any files the user has shared. Consult these when the user's question touches on policy or process. They are excerpts, not whole documents — if something needed is missing, ask the user rather than assuming.\n${entries.join("\n")}\n</reference_documents>`;
};

const buildSkillsBlock = (skills: ResolvedSkill[]): string => {
  if (skills.length === 0) return "";
  const rendered = skills
    .map((skill) => `  <skill name="${skill.name}">\n    ${skill.body.trim()}\n  </skill>`)
    .join("\n");
  return `\n\n<skills>\n${rendered}\n</skills>`;
};

const buildColleagueDescription = (userProfile: PromptUserProfile | null): string => {
  const name = userProfile?.name?.trim();
  const role = userProfile?.role?.trim();
  const team = userProfile?.team?.trim();
  if (!name && !role && !team) return "a colleague";

  const subject = name ? name : "a colleague";
  const roleClause = role && team ? `, ${role} on the ${team} team` : role ? `, ${role}` : team ? ` on the ${team} team` : "";
  return `${subject}${roleClause}`;
};

const buildRoleBlock = (
  expertRole: string | null,
  organisationName: string | null,
  workflowName: string,
  userProfile: PromptUserProfile | null,
): string => {
  const expertSentences = expertRole
    ? `You are a world-class ${expertRole} with over 20 years of experience${organisationName ? ` at ${organisationName}` : ""}. You understand its processes, culture, and requirements intimately. `
    : "";
  const colleague = buildColleagueDescription(userProfile);
  return `<role>
  ${expertSentences}You are currently helping ${colleague} complete the "${workflowName}" workflow, guiding them through it step by step. Address them by name where it feels natural. Stay focused on this step only — do not anticipate future steps.
</role>`;
};
