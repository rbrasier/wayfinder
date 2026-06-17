import {
  domainError,
  err,
  ok,
  type AutoNodeConfig,
  type Flow,
  type FlowNode,
  type ILanguageModel,
  type INodeExecutor,
  type ISessionRepository,
  type ISessionStepOutputRepository,
  type NodeExecutionOutput,
  type Result,
  type Session,
  type SessionMessage,
} from "@rbrasier/domain";
import { accumulateInsights } from "../../services/accumulate-insights";
import { resolveFieldValues } from "../../services/resolve-field-values";

export interface RunAutoNodeInput {
  session: Session;
  flow: Flow;
  node: FlowNode;
  messages: SessionMessage[];
  userId: string;
  userRole: "admin" | "user";
}

export interface RunAutoNodeOutput {
  correlationId: string;
  status: NodeExecutionOutput["status"];
  message?: string;
  // The executor's synchronous result data. Only populated when an executor
  // (e.g. the mock) completes inline; n8n returns `pending` with empty data and
  // delivers the real result via the inbound callback.
  data: Record<string, unknown>;
}

export interface RunAutoNodeClock {
  generateCorrelationId: () => string;
  now: () => Date;
}

// The node's `config.executor` selects which executor runs: `n8n` dispatches the
// real (async) workflow, `mock` completes synchronously for testing.
export interface NodeExecutors {
  n8n: INodeExecutor;
  mock: INodeExecutor;
}

const defaultClock: RunAutoNodeClock = {
  generateCorrelationId: () => globalThis.crypto.randomUUID(),
  now: () => new Date(),
};

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const buildTranscript = (messages: SessionMessage[]): string =>
  messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n")
    .slice(0, 8000);

export class RunAutoNode {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly languageModel: ILanguageModel,
    private readonly executors: NodeExecutors,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
    private readonly clock: RunAutoNodeClock = defaultClock,
  ) {}

  async execute(input: RunAutoNodeInput): Promise<Result<RunAutoNodeOutput>> {
    const config = input.node.config as unknown as AutoNodeConfig;

    if (config.executor !== "mock" && !config.webhookUrl) {
      return err(domainError("VALIDATION_FAILED", "Auto node has no n8n workflow configured."));
    }

    const requestFields = config.requestFields ?? [];
    const priorOutputs = await this.sessionStepOutputs.listBySession(input.session.id);
    const fieldsResult = await resolveFieldValues(this.languageModel, {
      fields: requestFields,
      valueSources: config.requestFieldValues ?? {},
      priorStepOutputs: priorOutputs.error ? [] : priorOutputs.data,
      insights: accumulateInsights(input.messages),
      transcript: buildTranscript(input.messages),
      contextDocs: input.flow.contextDocs,
      instruction: config.instruction,
      purpose: "autoNodeFields",
      userId: input.userId,
      flowId: input.flow.id,
      sessionId: input.session.id,
    });
    if (fieldsResult.error) return fieldsResult;

    const correlationId = this.clock.generateCorrelationId();
    const sentAt = this.clock.now().toISOString();

    const recorded = await this.sessions.update(input.session.id, {
      pendingExecutions: {
        ...input.session.pendingExecutions,
        [correlationId]: { nodeId: input.node.id, status: "pending", sentAt },
      },
    });
    if (recorded.error) return recorded;

    const executor = config.executor === "mock" ? this.executors.mock : this.executors.n8n;
    const executed = await executor.execute({
      nodeId: input.node.id,
      sessionId: input.session.id,
      userId: input.userId,
      userRole: input.userRole,
      flowId: input.flow.id,
      flowSlug: slugify(input.flow.name),
      sessionTitle: input.session.title ?? "",
      instruction: config.instruction,
      correlationId,
      webhookUrl: config.webhookUrl,
      fields: fieldsResult.data,
      responseFields: config.responseFields ?? [],
    });
    if (executed.error) return executed;

    return ok({
      correlationId,
      status: executed.data.status,
      message: executed.data.message,
      data: executed.data.data,
    });
  }
}
