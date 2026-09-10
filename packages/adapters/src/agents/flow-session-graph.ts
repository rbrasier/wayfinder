import {
  SIGNATURE_SLOT_MARKER,
  buildFieldConstraintsText,
  gatherableTemplateContent,
  nodeFieldSet,
  normaliseOutputType,
  ok,
  type BuildBranchChoicePromptInput,
  type BuildSystemPromptInput,
  type ISessionAgent,
  type PromptSessionUpload,
  type PromptUserProfile,
  type ResolvedLesson,
  type ResolvedSkill,
  type Result,
  type RetrievedChunk,
  type TemplateField,
} from "@wayfinder/domain";

// The reply is one field of a JSON object, and a model asked for JSON will
// sometimes escape the escape — writing the two characters `\` and `n` where a
// line break was meant, which then print on screen. The vocabulary is kept to
// what the chat bubble renders well: headings collapse to a bold lead-in there,
// so asking for one buys nothing, and tables and fences have no styling at all.
const FORMATTING_BLOCK = `<formatting>
  Write the "response" field as plain, readable text. The only formatting you may use is:
  - Short paragraphs
  - **bold** for a key term or label
  - "- " at the start of a line for a bulleted list
  - "1. " at the start of a line for a numbered list

  Use nothing else — no headings, tables, code blocks, links, images or HTML.

  Break a line by putting an actual line break in the string. Never write a line break out as characters: a reply containing \\n shows those characters to the user instead of starting a new line.
</formatting>`;

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
    // Accepted flow-memory lessons (ADR-057 §5), resolved live rather than from
    // the pinned snapshot (ADR-058). Sits beside <skills> in the cache-stable
    // region, above every per-turn block, so accepting one costs a single cache
    // miss rather than one on every turn forever (ADR-016).
    const learnedGuidanceBlock = buildLearnedGuidanceBlock(input.acceptedLessons ?? []);

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

    const outputType = normaliseOutputType(nodeConfig.outputType);

    // The current date/time changes every turn, so — like the retrieved chunks —
    // it is appended after the stable structural prompt to preserve prompt-cache
    // hits on everything above.
    const currentContextBlock = input.now ? buildCurrentContextBlock(input.now) : "";

    // The body is masked before it is interpolated, or the model reads the
    // template's `(approval)` tags as more information to gather and asks the
    // operator to supply a signature (ADR-043 §2).
    const rawTemplateContent =
      nodeConfig.documentTemplateStructuredContent ?? nodeConfig.documentTemplateContent;
    const templateContent = gatherableTemplateContent(rawTemplateContent);
    const templateBlock =
      outputType === "generate_document" && templateContent
        ? `\n\n  <document_template>\n    This step produces a document. Your goal is to gather all information needed to fully complete the following template:\n    ${templateContent}\n  </document_template>`
        : "";

    // Masking removes the tag but not the label the template puts in front of
    // it, so the constraint says what the remaining marker means. Added only
    // when a slot was actually masked — a template with no signature gets no
    // instruction about signatures.
    const signatureConstraint =
      templateBlock && templateContent !== rawTemplateContent
        ? `\n  - ${SIGNATURE_SLOT_MARKER} is recorded by an approval step later in the flow — never ask the user for it, never treat it as missing, and never report it as outstanding`
        : "";

    // The "all fields captured" sentinel is shared by template and structured
    // steps (ADR-038 §3), so its expansion stays neutral — it must read
    // naturally whether or not a document is produced.
    const effectiveDoneWhen =
      nodeConfig.doneWhen === "__TEMPLATE_COMPLETE__"
        ? "All required fields for this step have been gathered from the user and can be fully populated."
        : nodeConfig.doneWhen;

    // A structured step gathers its author-declared fields; a template step
    // gathers its parsed template fields. Both read one set through nodeFieldSet
    // and both get the field-format guidance so the model reformats input.
    const gatheredFields = input.templateFields ?? nodeFieldSet(nodeConfig);
    const fieldFormatsBlock =
      (outputType === "generate_document" || outputType === "structured") &&
      gatheredFields.length > 0
        ? buildFieldFormatsBlock(gatheredFields)
        : "";

    const prompt = `${roleBlock}${globalInstructionsBlock}${skillsBlock}${learnedGuidanceBlock}

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
  - If the user goes off-topic, gently redirect them back to this step${signatureConstraint}
</constraints>${fieldFormatsBlock}

${FORMATTING_BLOCK}

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
        const rule = node.rule?.trim();
        // A rule is the author's own statement of when to take the branch, so it
        // is labelled as a condition. A purpose is only the step describing
        // itself — labelling the two the same way would invite the model to read
        // a job description as a routing condition.
        if (rule) return `- ${node.id} (${node.name})\n  Take this branch when: ${rule}`;

        const purpose = node.purpose?.trim();
        if (purpose) return `- ${node.id} (${node.name})\n  This step's own description: ${purpose}`;

        return `- ${node.id} (${node.name})`;
      })
      .join("\n");

    const prompt = `Based on the conversation below, select the most appropriate next step.

Each branch lists its node id and name. A branch may also carry a stated condition ("Take this branch when: …") written by the workflow's author — where one is given, it is the authority on when that branch applies, so match the conversation against it directly. A branch with only "This step's own description" has no stated condition; infer from that description whether the conversation calls for it, and prefer a branch whose stated condition clearly matches over one you had to infer.

Available branches:
${branchList}

First explain your reasoning, then give the chosen node id. Return only: { "rationale": "<why this branch fits>", "branchChoice": "<nodeId>" }`;

    return ok(prompt);
  }
}

// A narrative field inverts the default "capture what the user said": the model
// writes the prose itself. Its brief is already in the constraints line, but
// without this the model has no direction to *use* it in conversation — so it
// asks for the bare field name and composes from a one-line answer.
const buildNarrativeDirective = (templateFields: TemplateField[]): string => {
  if (!templateFields.some((field) => field.type === "narrative")) return "";
  return `\n  Some fields are narrative prose. Where one carries a brief, treat the brief as what the finished prose must cover: explain what it needs to cover in your own words, ask for whatever is still missing, and never read the brief out verbatim. When you have enough, compose the prose yourself rather than pasting back what the user said — they are giving you the material, not the wording.\n`;
};

const buildFieldFormatsBlock = (templateFields: TemplateField[]): string => {
  const indented = buildFieldConstraintsText(templateFields)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return `\n\n<field_formats>
  This step captures fields with required formats. When the user gives you information for a field, silently reformat it into the required format yourself whenever you reasonably can — for example, turn "next Tuesday" or "3rd of June" into DD-MM-YYYY, or "twelve hundred dollars" into $1,200.00. Only ask the user to clarify when you genuinely cannot determine or format a value. For (options) fields, map what the user says to the closest listed value; if none clearly fits, ask them to choose.

  Dates are always day-first: in DD-MM-YYYY the first number is the day and the second is the month. This holds in both directions. Writing one out, "10 Aug 2026" becomes 10-08-2026, never 08-10-2026. Reading one that is already in that format, 10-08-2026 means 10 August 2026, never 8 October 2026. Keep the month the user named, and never swap a day and month to reach a date that looks more plausible.
${buildNarrativeDirective(templateFields)}
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

// Renders nothing at all for an empty list, so a flow with no memory produces a
// byte-identical prompt to the one it produced before this feature existed.
const buildLearnedGuidanceBlock = (lessons: ResolvedLesson[]): string => {
  if (lessons.length === 0) return "";
  const rendered = lessons.map((lesson) => `  - ${lesson.statement}`).join("\n");
  return `\n\n<learned_guidance>\n  Guidance accepted by this workflow's owner, learned from how earlier sessions on it actually went. Follow it alongside the instructions below; it never overrides them.\n${rendered}\n</learned_guidance>`;
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
