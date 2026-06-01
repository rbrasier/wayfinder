import type { RetrievedChunk } from "../entities/document-chunk";
import type { ConversationalNodeConfig } from "../entities/flow-node";
import type { TemplateField } from "../entities/template-field";
import type { Result } from "../result";

export interface PromptUserProfile {
  name: string | null;
  role: string | null;
  team: string | null;
}

export interface BuildSystemPromptInput {
  nodeConfig: ConversationalNodeConfig;
  // Chunks retrieved per turn by cosine similarity to the user's latest message
  // (see ADR-016). Empty when nothing scores above the similarity threshold, in
  // which case no reference-documents block is rendered.
  retrievedChunks?: RetrievedChunk[];
  gatheredContext: string;
  workflowName: string;
  organisationName: string | null;
  expertRole: string | null;
  userProfile?: PromptUserProfile | null;
  templateFields?: TemplateField[];
}

export interface BuildBranchChoicePromptInput {
  branchNodes: { id: string; name: string; purpose?: string }[];
}

export interface ISessionAgent {
  buildSystemPrompt(input: BuildSystemPromptInput): Result<string>;
  buildBranchChoicePrompt(input: BuildBranchChoicePromptInput): Result<string>;
}
