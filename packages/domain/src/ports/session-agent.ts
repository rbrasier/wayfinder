import type { RetrievedChunk } from "../entities/document-chunk";
import type { ConversationalNodeConfig } from "../entities/flow-node";
import type { ResolvedLesson } from "../entities/flow-lesson";
import type { ResolvedSkill } from "../entities/skill";
import type { TemplateField } from "../entities/template-field";
import type { Result } from "../result";

export interface PromptUserProfile {
  name: string | null;
  role: string | null;
  team: string | null;
}

export interface PromptSessionUpload {
  filename: string;
  extractedText: string;
}

export interface BuildSystemPromptInput {
  nodeConfig: ConversationalNodeConfig;
  // Chunks retrieved per turn by cosine similarity to the user's latest message
  // (see ADR-016). Empty when nothing scores above the similarity threshold, in
  // which case no reference-documents block is rendered.
  retrievedChunks?: RetrievedChunk[];
  // Documents the user attached to this session, injected in full (budget-capped
  // by the caller) and independent of RAG, so a thin message still lets the agent
  // see the attachment instead of asking the user to paste it.
  sessionUploads?: PromptSessionUpload[];
  gatheredContext: string;
  workflowName: string;
  organisationName: string | null;
  // Operator-set, organisation-wide guidance (tone, spelling, house style)
  // applied to every session prompt. Null when unset.
  globalInstructions?: string | null;
  expertRole: string | null;
  userProfile?: PromptUserProfile | null;
  templateFields?: TemplateField[];
  // The moment the turn is being built, so the prompt can state "now" and the
  // model can resolve relative/short dates ("next Tuesday", "the 3rd") the user
  // mentions. Omitted only by callers with no wall-clock context to supply.
  now?: Date;
  // Skills applied to this step (ADR-031), already resolved from skillRefs +
  // inlineSkill by the caller. Rendered as a cache-stable <skills> block.
  resolvedSkills?: ResolvedSkill[];
  // Accepted flow-memory lessons for this step, resolved live rather than from
  // the pinned version snapshot (ADR-058) and already filtered and capped by the
  // caller. Rendered as a <learned_guidance> block in the same cache-stable
  // region as <skills>; absent or empty renders nothing at all.
  acceptedLessons?: ResolvedLesson[];
}

// `rule` is the author's stated condition for taking the branch, held on the
// edge. `purpose` is the destination step's own description, standing in when no
// rule was written. A branch carries at most one of them (see
// `buildBranchDescriptors`).
export interface BuildBranchChoicePromptInput {
  branchNodes: { id: string; name: string; rule?: string; purpose?: string }[];
}

export interface ISessionAgent {
  buildSystemPrompt(input: BuildSystemPromptInput): Result<string>;
  buildBranchChoicePrompt(input: BuildBranchChoicePromptInput): Result<string>;
}
