import type { FlowContextDoc } from "../entities/flow";
import type { ConversationalNodeConfig } from "../entities/flow-node";
import type { TemplateField } from "../entities/template-field";
import type { Result } from "../result";

export interface BuildSystemPromptInput {
  nodeConfig: ConversationalNodeConfig;
  contextDocs: FlowContextDoc[];
  gatheredContext: string;
  workflowName: string;
  organisationName: string | null;
  expertRole: string | null;
  templateFields?: TemplateField[];
}

export interface BuildBranchChoicePromptInput {
  branchNodes: { id: string; name: string }[];
}

export interface ISessionAgent {
  buildSystemPrompt(input: BuildSystemPromptInput): Result<string>;
  buildBranchChoicePrompt(input: BuildBranchChoicePromptInput): Result<string>;
}
