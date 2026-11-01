import type { ILanguageModel, INodeExecutor } from "@wayfinder/domain";
import { MockNodeExecutor } from "./mock-node-executor";
import { N8nNodeExecutor } from "./n8n-node-executor";

export * from "./mock-node-executor";
export * from "./n8n-node-executor";

export interface NodeExecutors {
  n8n: INodeExecutor;
  mock: INodeExecutor;
}

// Both executors are always available; the node's `config.executor` selects
// which one runs. The real n8n executor needs the shared webhook secret to sign
// its outbound request; without it the mock stands in for the n8n slot too so
// local dev/test never throws (ADR-013 §7).
export const createNodeExecutors = (
  mockLanguageModel: ILanguageModel,
  webhookSecret?: string | null,
): NodeExecutors => {
  const mock = new MockNodeExecutor(mockLanguageModel);
  return {
    n8n: webhookSecret ? new N8nNodeExecutor(webhookSecret) : mock,
    mock,
  };
};
