import {
  type Flow,
  type FlowNode,
  type Result,
  type Session,
  type SessionMessage,
  type SessionSchedule,
  type SessionStepOutput,
} from "@rbrasier/domain";
import { accumulateInsights } from "../../services/accumulate-insights";
import type { ScheduleNodeEventInput } from "../scheduling/schedule-node-event";
import type { ApplyAutoNodeResultInput, ApplyAutoNodeResultOutput } from "../session/apply-auto-node-result";
import type { RunAiTaskNodeInput, RunAiTaskNodeOutput } from "../session/run-ai-task-node";
import type { RunAutoNodeInput, RunAutoNodeOutput } from "../session/run-auto-node";
import type { RunEmailNodeInput, RunEmailNodeOutput } from "../session/run-email-node";
import type { RunMcpNodeInput, RunMcpNodeOutput } from "../session/run-mcp-node";

// The existing step use cases, as the driver calls them. Functions rather than
// classes so the app wires each to its container instance.
export interface UnattendedStepRunners {
  runAiTask: (input: RunAiTaskNodeInput) => Promise<Result<RunAiTaskNodeOutput>>;
  runEmail: (input: RunEmailNodeInput) => Promise<Result<RunEmailNodeOutput>>;
  runAuto: (input: RunAutoNodeInput) => Promise<Result<RunAutoNodeOutput>>;
  runMcp: (input: RunMcpNodeInput) => Promise<Result<RunMcpNodeOutput>>;
  // Applies a synchronous auto/MCP completion, which advances the session itself.
  applyExecutionResult: (input: ApplyAutoNodeResultInput) => Promise<Result<ApplyAutoNodeResultOutput>>;
  scheduleNode: (input: ScheduleNodeEventInput) => Promise<Result<SessionSchedule>>;
  // Raises an approval step's request with no operator to confirm the approver;
  // `approverAssigned: false` means a person must pick one.
  requestApproval: (session: Session, node: FlowNode) => Promise<Result<{ approverAssigned: boolean }>>;
  // Readies a conversational step for the person who takes it over (the AI's
  // opening message). Lives in the app, where the chat machinery is.
  prepareConversationalStep?: (session: Session, node: FlowNode) => Promise<void>;
}

export interface StepContext {
  session: Session;
  flow: Flow;
  node: FlowNode;
  messages: SessionMessage[];
  priorStepOutputs: SessionStepOutput[];
}

export type StepOutcome =
  // The step finished; the driver follows its outgoing edge.
  | { kind: "done" }
  // The step moved the session on itself (a synchronous auto/MCP completion).
  | { kind: "moved" }
  // Parked: a reviewer, a callback, a schedule or a person.
  | { kind: "waiting"; needsPerson: boolean }
  | { kind: "failed"; code: string; message: string };

const failed = (error: { code: string; message: string }): StepOutcome => ({
  kind: "failed",
  code: error.code,
  message: error.message,
});

const sessionMetadata = (messages: SessionMessage[]): Record<string, string> =>
  Object.fromEntries(accumulateInsights(messages).map((insight) => [insight.key, insight.value]));

// One step of an unattended run. The caller has already checked the step's
// feature flag and that it is the session's current node.
export const runUnattendedStep = async (
  runners: UnattendedStepRunners,
  context: StepContext,
): Promise<StepOutcome> => {
  const { session, flow, node, messages } = context;

  switch (node.type) {
    case "ai_task": {
      const result = await runners.runAiTask({ session, flow, node, messages });
      if (result.error) return failed(result.error);
      return result.data.outcome === "accepted" ? { kind: "done" } : { kind: "waiting", needsPerson: false };
    }
    case "email": {
      const result = await runners.runEmail({ session, flow, node });
      return result.error ? failed(result.error) : { kind: "done" };
    }
    case "auto":
    case "mcp": {
      const result =
        node.type === "auto"
          ? await runners.runAuto({ session, flow, node, messages, userId: session.userId, userRole: "user" })
          : await runners.runMcp({ session, flow, node, messages, userId: session.userId });
      if (result.error) return failed(result.error);
      if (result.data.status === "failed") {
        return { kind: "failed", code: "step_failed", message: result.data.message ?? "The step reported a failure." };
      }
      if (result.data.status !== "completed") return { kind: "waiting", needsPerson: false };
      const applied = await runners.applyExecutionResult({
        sessionId: session.id,
        correlationId: result.data.correlationId,
        nodeId: node.id,
        status: "completed",
        data: result.data.data,
      });
      return applied.error ? failed(applied.error) : { kind: "moved" };
    }
    case "scheduled": {
      const result = await runners.scheduleNode({
        session,
        node,
        metadata: sessionMetadata(messages),
        priorStepOutputs: context.priorStepOutputs,
        insights: accumulateInsights(messages),
        contextDocs: flow.contextDocs,
      });
      if (result.error) return failed(result.error);
      if (result.data.status === "failed") {
        return { kind: "failed", code: "schedule_failed", message: "The scheduled step could not be scheduled." };
      }
      return { kind: "waiting", needsPerson: false };
    }
    case "approval": {
      const result = await runners.requestApproval(session, node);
      if (result.error) return failed(result.error);
      return { kind: "waiting", needsPerson: !result.data.approverAssigned };
    }
    case "conversational": {
      await runners.prepareConversationalStep?.(session, node);
      return { kind: "waiting", needsPerson: true };
    }
  }
};
