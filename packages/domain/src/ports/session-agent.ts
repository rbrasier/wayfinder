import type { FlowContextDoc } from "../entities/flow";
import type { ConversationalNodeConfig } from "../entities/flow-node";
import type { Result } from "../result";

export interface BuildSystemPromptInput {
  nodeConfig: ConversationalNodeConfig;
  contextDocs: FlowContextDoc[];
  gatheredContext: string;
  workflowName: string;
  organisationName: string | null;
  expertRole: string | null;
}

export interface BuildBranchChoicePromptInput {
  branchNodes: { id: string; name: string }[];
}

export interface ISessionAgent {
  buildSystemPrompt(input: BuildSystemPromptInput): Result<string>;
  buildBranchChoicePrompt(input: BuildBranchChoicePromptInput): Result<string>;
}
