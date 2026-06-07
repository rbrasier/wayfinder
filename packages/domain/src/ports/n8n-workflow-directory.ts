import type { N8nWorkflowSchema, N8nWorkflowSummary } from "../entities/n8n-workflow";
import type { Result } from "../result";

export interface IN8nWorkflowDirectory {
  listWorkflows(): Promise<Result<N8nWorkflowSummary[]>>;
  // The full input/output schema for one workflow, resolved via the fallback
  // chains. Consults execution history only when the free methods find nothing.
  getWorkflowSchema(workflowId: string): Promise<Result<N8nWorkflowSchema>>;
}
