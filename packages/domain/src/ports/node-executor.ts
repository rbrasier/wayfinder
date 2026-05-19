import type { Result } from "../result";

export interface NodeExecutionInput {
  nodeId: string;
  sessionId: string;
  userId: string;
  userRole: "admin" | "user";
  flowId: string;
  fields: Record<string, unknown>;
}

export interface NodeExecutionOutput {
  status: "completed" | "pending_approval" | "failed";
  data: Record<string, unknown>;
  message?: string;
}

export interface INodeExecutor {
  execute(input: NodeExecutionInput): Promise<Result<NodeExecutionOutput>>;
}
