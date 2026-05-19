import type { FlowContextDoc } from "../entities/flow";
import type { ConversationalNodeConfig } from "../entities/flow-node";
import type { Result } from "../result";

export interface MessageInput {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface BuildSystemPromptInput {
  nodeConfig: ConversationalNodeConfig;
  contextDocs: FlowContextDoc[];
  gatheredContext: string;
}

export interface BuildConfidencePromptInput {
  nodeConfig: ConversationalNodeConfig;
}

export interface ISessionAgent {
  buildSystemPrompt(input: BuildSystemPromptInput): Result<string>;
  buildConfidenceSystemPrompt(input: BuildConfidencePromptInput): Result<string>;
}
