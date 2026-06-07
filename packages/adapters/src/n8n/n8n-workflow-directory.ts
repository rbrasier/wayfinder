import {
  domainError,
  err,
  ok,
  type IN8nWorkflowDirectory,
  type N8nConfig,
  type N8nSchemaMethod,
  type N8nTrigger,
  type N8nWorkflowSchema,
  type N8nWorkflowSummary,
  type Result,
  type TemplateField,
  type TemplateFieldType,
} from "@rbrasier/domain";
import {
  N8nHttpExecutionClient,
  type IN8nExecutionClient,
} from "./n8n-execution-client";

interface N8nNode {
  name?: string;
  type?: string;
  parameters?: Record<string, unknown>;
}

interface N8nWorkflow {
  id?: string;
  name?: string;
  active?: boolean;
  nodes?: N8nNode[];
  connections?: Record<string, unknown>;
  pinData?: Record<string, unknown>;
}

interface SchemaResolution {
  fields: TemplateField[];
  method: N8nSchemaMethod;
}

const WEBHOOK_TYPE = "n8n-nodes-base.webhook";
const SET_TYPE = "n8n-nodes-base.set";
const RESPOND_TYPE = "n8n-nodes-base.respondToWebhook";
const PAGE_LIMIT = 250;
const MAX_PAGES = 50;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mapFieldType = (n8nType: unknown): TemplateFieldType => {
  switch (n8nType) {
    case "number":
      return "number";
    case "boolean":
      return "yesno";
    case "dateTime":
    case "date":
      return "date";
    default:
      return "text";
  }
};

const buildField = (name: unknown, n8nType: unknown): TemplateField | null => {
  if (typeof name !== "string") return null;
  const label = name.trim();
  if (!label) return null;
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key) return null;
  return { key, label, type: mapFieldType(n8nType), optional: false, raw: label };
};

// n8n's "Edit Fields (Set)" node: v3.4+ stores `parameters.assignments.assignments`
// as `[{ name, type, value }]`; older versions store `parameters.values` keyed by
// type. Both are read best-effort.
const fieldsFromSetNode = (node: N8nNode): TemplateField[] => {
  const parameters = node.parameters ?? {};
  const fields: TemplateField[] = [];

  const assignments = isObject(parameters.assignments) ? parameters.assignments.assignments : undefined;
  if (Array.isArray(assignments)) {
    for (const assignment of assignments) {
      if (!isObject(assignment)) continue;
      const field = buildField(assignment.name, assignment.type);
      if (field) fields.push(field);
    }
    return fields;
  }

  const values = parameters.values;
  if (isObject(values)) {
    for (const [n8nType, entries] of Object.entries(values)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!isObject(entry)) continue;
        const field = buildField(entry.name, n8nType);
        if (field) fields.push(field);
      }
    }
  }
  return fields;
};

const fieldsFromRespondNode = (node: N8nNode): TemplateField[] => {
  const body = node.parameters?.responseBody;
  if (typeof body !== "string") return [];
  try {
    const parsed = JSON.parse(body);
    if (!isObject(parsed)) return [];
    return Object.keys(parsed)
      .map((key) => buildField(key, typeof parsed[key]))
      .filter((field): field is TemplateField => field !== null);
  } catch {
    return [];
  }
};

const findSetNode = (nodes: N8nNode[], named: RegExp): N8nNode | undefined =>
  nodes.find((node) => node.type === SET_TYPE && typeof node.name === "string" && named.test(node.name));

const firstSetNode = (nodes: N8nNode[]): N8nNode | undefined =>
  nodes.find((node) => node.type === SET_TYPE);

const TRIGGER_TYPE_HINT = /trigger|webhook/i;

const fieldsFromObject = (value: unknown): TemplateField[] => {
  if (!isObject(value)) return [];
  return Object.keys(value)
    .map((key) => buildField(key, typeof value[key]))
    .filter((field): field is TemplateField => field !== null);
};

// n8n pinData stores a node's pinned items as `[{ json: {...} }]`; older pins may
// hold the raw object. Read the first item's shape best-effort.
const fieldsFromPinData = (pinData: Record<string, unknown>, nodeName: string | undefined): TemplateField[] => {
  if (!nodeName) return [];
  const pinned = pinData[nodeName];
  if (!Array.isArray(pinned) || pinned.length === 0) return [];
  const first = pinned[0];
  if (!isObject(first)) return [];
  return fieldsFromObject(isObject(first.json) ? first.json : first);
};

const collectStrings = (value: unknown, into: string[]): void => {
  if (typeof value === "string") return void into.push(value);
  if (Array.isArray(value)) return void value.forEach((item) => collectStrings(item, into));
  if (isObject(value)) return void Object.values(value).forEach((item) => collectStrings(item, into));
};

// Heuristic scan for `$json.<key>` and `$json["key"]` references across all node
// parameter strings — best-effort, deduplicated, scoped to obvious forms.
const fieldsFromExpressions = (nodes: N8nNode[]): TemplateField[] => {
  const strings: string[] = [];
  for (const node of nodes) collectStrings(node.parameters, strings);

  const keys = new Set<string>();
  for (const text of strings) {
    for (const match of text.matchAll(/\$json\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
      if (match[1]) keys.add(match[1]);
    }
    for (const match of text.matchAll(/\$json\[['"]([^'"\]]+)['"]\]/g)) {
      if (match[1]) keys.add(match[1]);
    }
  }
  return [...keys]
    .map((key) => buildField(key, "string"))
    .filter((field): field is TemplateField => field !== null);
};

const connectionTargets = (connections: Record<string, unknown>): Set<string> => {
  const targets = new Set<string>();
  for (const outgoing of Object.values(connections)) {
    if (!isObject(outgoing)) continue;
    for (const slots of Object.values(outgoing)) {
      if (!Array.isArray(slots)) continue;
      for (const slot of slots) {
        if (!Array.isArray(slot)) continue;
        for (const link of slot) {
          if (isObject(link) && typeof link.node === "string") targets.add(link.node);
        }
      }
    }
  }
  return targets;
};

const nodeByName = (nodes: N8nNode[], name: string): N8nNode | undefined =>
  nodes.find((node) => node.name === name);

// The trigger is a node of a trigger/webhook type, falling back to a node with
// no incoming connection (a source of the graph).
const findTriggerNode = (nodes: N8nNode[], connections: Record<string, unknown>): N8nNode | undefined => {
  const typed = nodes.find((node) => typeof node.type === "string" && TRIGGER_TYPE_HINT.test(node.type));
  if (typed) return typed;
  const targets = connectionTargets(connections);
  return nodes.find((node) => typeof node.name === "string" && !targets.has(node.name));
};

// The deepest node reachable from the trigger via `connections`. Workflows with
// multiple sinks resolve to whichever sink sits furthest from the trigger.
const findTerminalNode = (
  nodes: N8nNode[],
  connections: Record<string, unknown>,
  trigger: N8nNode | undefined,
): N8nNode | undefined => {
  const triggerName = trigger?.name;
  if (!triggerName || Object.keys(connections).length === 0) {
    return nodes[nodes.length - 1];
  }

  const adjacency = new Map<string, string[]>();
  for (const [source, outgoing] of Object.entries(connections)) {
    adjacency.set(source, [...collectLinks(outgoing)]);
  }

  const depth = new Map<string, number>([[triggerName, 0]]);
  const queue = [triggerName];
  let deepest = triggerName;
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depth.get(current) ?? 0;
    for (const next of adjacency.get(current) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, currentDepth + 1);
      if (currentDepth + 1 > (depth.get(deepest) ?? 0)) deepest = next;
      queue.push(next);
    }
  }
  return nodeByName(nodes, deepest) ?? nodes[nodes.length - 1];
};

const collectLinks = (outgoing: unknown): Set<string> => {
  const links = new Set<string>();
  if (!isObject(outgoing)) return links;
  for (const slots of Object.values(outgoing)) {
    if (!Array.isArray(slots)) continue;
    for (const slot of slots) {
      if (!Array.isArray(slot)) continue;
      for (const link of slot) {
        if (isObject(link) && typeof link.node === "string") links.add(link.node);
      }
    }
  }
  return links;
};

// Outputs fallback chain: Set "Output(s)" → RespondToWebhook → pinData(terminal).
const resolveOutputs = (
  nodes: N8nNode[],
  pinData: Record<string, unknown>,
  terminal: N8nNode | undefined,
): SchemaResolution => {
  const setNode = findSetNode(nodes, /^outputs?$/i);
  const setFields = setNode ? fieldsFromSetNode(setNode) : [];
  if (setFields.length > 0) return { fields: setFields, method: "set" };

  const respondNode = nodes.find((node) => node.type === RESPOND_TYPE);
  const respondFields = respondNode ? fieldsFromRespondNode(respondNode) : [];
  if (respondFields.length > 0) return { fields: respondFields, method: "respond" };

  const pinFields = fieldsFromPinData(pinData, terminal?.name);
  if (pinFields.length > 0) return { fields: pinFields, method: "pin" };

  return { fields: [], method: "none" };
};

// Inputs fallback chain: Set "Input(s)" → pinData(trigger) → `$json` scan.
const resolveInputs = (
  nodes: N8nNode[],
  pinData: Record<string, unknown>,
  trigger: N8nNode | undefined,
): SchemaResolution => {
  const setNode = findSetNode(nodes, /^inputs?$/i);
  const setFields = setNode ? fieldsFromSetNode(setNode) : [];
  if (setFields.length > 0) return { fields: setFields, method: "set" };

  const pinFields = fieldsFromPinData(pinData, trigger?.name);
  if (pinFields.length > 0) return { fields: pinFields, method: "pin" };

  const expressionFields = fieldsFromExpressions(nodes);
  if (expressionFields.length > 0) return { fields: expressionFields, method: "expression" };

  return { fields: [], method: "none" };
};

const augmentFromExecution = (
  current: SchemaResolution,
  node: N8nNode | undefined,
  nodeOutputs: Record<string, Record<string, unknown>>,
): SchemaResolution => {
  if (current.method !== "none" || !node?.name) return current;
  const fields = fieldsFromObject(nodeOutputs[node.name]);
  return fields.length > 0 ? { fields, method: "execution" } : current;
};

const resolveTrigger = (
  nodes: N8nNode[],
  baseUrl: string,
): { trigger: N8nTrigger; webhookUrl: string | null } => {
  const webhook = nodes.find((node) => node.type === WEBHOOK_TYPE);
  if (!webhook) {
    return { trigger: { kind: "manual_or_scheduled" }, webhookUrl: null };
  }
  const parameters = webhook.parameters ?? {};
  const method = typeof parameters.httpMethod === "string" ? parameters.httpMethod : "GET";
  const path = typeof parameters.path === "string" ? parameters.path : "";
  const authentication =
    typeof parameters.authentication === "string" ? parameters.authentication : "none";
  return {
    trigger: { kind: "webhook", method, path, authentication },
    webhookUrl: path ? `${baseUrl}/webhook/${path}` : null,
  };
};

const toSummary = (workflow: N8nWorkflow, baseUrl: string): N8nWorkflowSummary | null => {
  if (typeof workflow.id !== "string") return null;
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const { trigger, webhookUrl } = resolveTrigger(nodes, baseUrl);

  const inputsNode = findSetNode(nodes, /^inputs?$/i) ?? firstSetNode(nodes);
  const inputs = inputsNode ? fieldsFromSetNode(inputsNode) : [];

  const outputsSetNode = findSetNode(nodes, /^outputs?$/i);
  const respondNode = nodes.find((node) => node.type === RESPOND_TYPE);
  const outputs = outputsSetNode
    ? fieldsFromSetNode(outputsSetNode)
    : respondNode
      ? fieldsFromRespondNode(respondNode)
      : [];

  return {
    id: workflow.id,
    name: typeof workflow.name === "string" ? workflow.name : workflow.id,
    active: workflow.active === true,
    trigger,
    webhookUrl,
    inputs,
    outputs,
  };
};

export class N8nHttpWorkflowDirectory implements IN8nWorkflowDirectory {
  constructor(
    private readonly getConfig: () => Promise<N8nConfig>,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly executionClient: IN8nExecutionClient = new N8nHttpExecutionClient(getConfig, fetchFn),
  ) {}

  async listWorkflows(): Promise<Result<N8nWorkflowSummary[]>> {
    const config = await this.getConfig();
    if (!config.baseUrl || !config.apiKey) {
      return err(domainError("VALIDATION_FAILED", "n8n is not configured. Add an instance in admin settings."));
    }

    const summaries: N8nWorkflowSummary[] = [];
    let cursor: string | null = null;

    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const url = new URL(`${config.baseUrl}/api/v1/workflows`);
        url.searchParams.set("limit", String(PAGE_LIMIT));
        if (cursor) url.searchParams.set("cursor", cursor);

        const response = await this.fetchFn(url.toString(), {
          headers: { "X-N8N-API-KEY": config.apiKey, Accept: "application/json" },
        });
        if (!response.ok) {
          return err(domainError("INFRA_FAILURE", `n8n API returned ${response.status}.`));
        }

        const payload = (await response.json()) as { data?: unknown; nextCursor?: unknown };
        const data = Array.isArray(payload.data) ? payload.data : [];
        for (const workflow of data) {
          if (!isObject(workflow)) continue;
          const summary = toSummary(workflow as N8nWorkflow, config.baseUrl);
          if (summary) summaries.push(summary);
        }

        cursor = typeof payload.nextCursor === "string" && payload.nextCursor.length > 0 ? payload.nextCursor : null;
        if (!cursor) break;
      }
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to reach the n8n API.", cause));
    }

    return ok(summaries);
  }

  async getWorkflowSchema(workflowId: string): Promise<Result<N8nWorkflowSchema>> {
    const config = await this.getConfig();
    if (!config.baseUrl || !config.apiKey) {
      return err(domainError("VALIDATION_FAILED", "n8n is not configured. Add an instance in admin settings."));
    }

    let workflow: N8nWorkflow;
    try {
      const url = `${config.baseUrl}/api/v1/workflows/${encodeURIComponent(workflowId)}`;
      const response = await this.fetchFn(url, {
        headers: { "X-N8N-API-KEY": config.apiKey, Accept: "application/json" },
      });
      if (!response.ok) {
        return err(domainError("INFRA_FAILURE", `n8n API returned ${response.status}.`));
      }
      workflow = (await response.json()) as N8nWorkflow;
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to reach the n8n API.", cause));
    }

    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    const connections = isObject(workflow.connections) ? workflow.connections : {};
    const pinData = isObject(workflow.pinData) ? workflow.pinData : {};
    const trigger = findTriggerNode(nodes, connections);
    const terminal = findTerminalNode(nodes, connections, trigger);

    const outputs = resolveOutputs(nodes, pinData, terminal);
    const inputs = resolveInputs(nodes, pinData, trigger);

    // The execution call is the only costly method: fire it lazily, once, and
    // only when a free method left a schema empty.
    if (outputs.method !== "none" && inputs.method !== "none") {
      return ok(toSchema(outputs, inputs, false));
    }

    const execution = await this.executionClient.getLatestExecution(workflowId);
    if (execution.error) {
      return ok(toSchema(outputs, inputs, false));
    }

    return ok(
      toSchema(
        augmentFromExecution(outputs, terminal, execution.data.nodeOutputs),
        augmentFromExecution(inputs, trigger, execution.data.nodeOutputs),
        execution.data.hasExecutions,
      ),
    );
  }
}

const toSchema = (
  outputs: SchemaResolution,
  inputs: SchemaResolution,
  hasExecutions: boolean,
): N8nWorkflowSchema => ({
  inputs: inputs.fields,
  outputs: outputs.fields,
  inputsMethod: inputs.method,
  outputsMethod: outputs.method,
  hasExecutions,
});
