import {
  domainError,
  err,
  ok,
  type N8nConfig,
  type Result,
} from "@rbrasier/domain";

// The latest execution of a workflow, reduced to each node's first JSON output.
// `hasExecutions` tells the caller whether the workflow has ever run, so an
// empty schema can be explained rather than silently shown blank.
export interface N8nExecutionData {
  hasExecutions: boolean;
  nodeOutputs: Record<string, Record<string, unknown>>;
}

export interface IN8nExecutionClient {
  getLatestExecution(workflowId: string): Promise<Result<N8nExecutionData>>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// runData is keyed by node name; each run holds `data.main[outputIndex][itemIndex].json`.
// We take the first item of the first output as the representative shape.
const parseRunData = (execution: unknown): Record<string, Record<string, unknown>> => {
  if (!isObject(execution)) return {};
  const data = execution.data;
  if (!isObject(data)) return {};
  const resultData = data.resultData;
  if (!isObject(resultData)) return {};
  const runData = resultData.runData;
  if (!isObject(runData)) return {};

  const nodeOutputs: Record<string, Record<string, unknown>> = {};
  for (const [nodeName, runs] of Object.entries(runData)) {
    if (!Array.isArray(runs) || runs.length === 0) continue;
    const firstRun = runs[0];
    if (!isObject(firstRun)) continue;
    const runDataItem = firstRun.data;
    if (!isObject(runDataItem)) continue;
    const main = runDataItem.main;
    if (!Array.isArray(main) || main.length === 0) continue;
    const firstOutput = main[0];
    if (!Array.isArray(firstOutput) || firstOutput.length === 0) continue;
    const firstItem = firstOutput[0];
    if (!isObject(firstItem) || !isObject(firstItem.json)) continue;
    nodeOutputs[nodeName] = firstItem.json;
  }
  return nodeOutputs;
};

export class N8nHttpExecutionClient implements IN8nExecutionClient {
  constructor(
    private readonly getConfig: () => Promise<N8nConfig>,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async getLatestExecution(workflowId: string): Promise<Result<N8nExecutionData>> {
    const config = await this.getConfig();
    if (!config.baseUrl || !config.apiKey) {
      return err(domainError("VALIDATION_FAILED", "n8n is not configured. Add an instance in admin settings."));
    }

    try {
      const url = new URL(`${config.baseUrl}/api/v1/executions`);
      url.searchParams.set("workflowId", workflowId);
      url.searchParams.set("includeData", "true");
      url.searchParams.set("limit", "1");

      const response = await this.fetchFn(url.toString(), {
        headers: { "X-N8N-API-KEY": config.apiKey, Accept: "application/json" },
      });
      if (!response.ok) {
        return err(domainError("INFRA_FAILURE", `n8n executions API returned ${response.status}.`));
      }

      const payload = (await response.json()) as { data?: unknown };
      const executions = Array.isArray(payload.data) ? payload.data : [];
      if (executions.length === 0) {
        return ok({ hasExecutions: false, nodeOutputs: {} });
      }

      return ok({ hasExecutions: true, nodeOutputs: parseRunData(executions[0]) });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to reach the n8n executions API.", cause));
    }
  }
}
