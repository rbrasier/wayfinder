import type { FlowContextDoc } from "../entities/flow";
import type { ConversationalNodeConfig } from "../entities/flow-node";
import type { SessionUpload } from "../entities/session-upload";
import type { TemplateField } from "../entities/template-field";
import type { Result } from "../result";

export interface PromptUserProfile {
  name: string | null;
  role: string | null;
  team: string | null;
}

export interface BuildSystemPromptInput {
  nodeConfig: ConversationalNodeConfig;
  contextDocs: FlowContextDoc[];
  gatheredContext: string;
  workflowName: string;
  organisationName: string | null;
  expertRole: string | null;
  userProfile?: PromptUserProfile | null;
  templateFields?: TemplateField[];
  sessionUploads?: SessionUpload[];
}

export interface BuildBranchChoicePromptInput {
  branchNodes: { id: string; name: string; purpose?: string }[];
}

export interface ISessionAgent {
  buildSystemPrompt(input: BuildSystemPromptInput): Result<string>;
  buildBranchChoicePrompt(input: BuildBranchChoicePromptInput): Result<string>;
}
