import {
  AdvanceUnattendedRun,
  RetryFailedStep,
  type AdvanceUnattendedRunInput,
} from "@wayfinder/application";
import { isUnattendedOrigin, type FlowNode, type Session } from "@wayfinder/domain";
import type { getContainer } from "@/lib/container";
import {
  resolveGlobalInstructions,
  resolveIsAdmin,
  resolveOrganisationName,
  resolveUserProfile,
} from "@/lib/chat/prompt-context";
import { buildGatheredContext, generateInitialMessage } from "@/app/api/chat/[sessionId]/stream/turn-helpers";
import { buildAiTaskContext } from "./ai-task-context";
import { publishStepActivity } from "./step-activity";
import { flagForStep, raiseUnattendedApproval } from "./unattended-approval";

type Container = ReturnType<typeof getContainer>;

// Gives a conversational step its opening message when an unattended run hands
// it to a person, exactly as a scheduled fire does.
const prepareConversationalStep = async (container: Container, session: Session, node: FlowNode) => {
  const loaded = await container.useCases.getSession.execute(session.id);
  if (loaded.error || !loaded.data) return;
  const aiConfig = await container.runtimeConfig.getAiConfig();
  await generateInitialMessage({
    container,
    sessionId: session.id,
    newNodeId: node.id,
    newNode: node,
    flow: loaded.data.flow,
    modelName: aiConfig.models.branching,
    organisationName: await resolveOrganisationName(container),
    userProfile: await resolveUserProfile(container, session.userId),
    userId: session.userId,
    isAdmin: await resolveIsAdmin(container, session.userId),
    gatheredContext: buildGatheredContext(loaded.data.messages),
    globalInstructions: await resolveGlobalInstructions(container),
    onToolActivity: publishStepActivity(container, session.id, node.id),
  });
};

// The run driver (ADR-065 §2), assembled per call from the container's step
// use cases. Cheap to build; nothing here holds state between calls.
export const buildAdvanceUnattendedRun = (container: Container): AdvanceUnattendedRun =>
  new AdvanceUnattendedRun({
    sessions: container.repos.sessions,
    flows: container.repos.flows,
    graph: {
      flowVersions: container.repos.flowVersions,
      flowNodes: container.repos.flowNodes,
      flowEdges: container.repos.flowEdges,
    },
    sessionMessages: container.repos.sessionMessages,
    sessionStepOutputs: container.repos.sessionStepOutputs,
    steps: {
      runAiTask: async (input) =>
        container.useCases.runAiTaskNode.execute({
          ...input,
          additionalContext: await buildAiTaskContext(container, input),
        }),
      runEmail: (input) => container.useCases.runEmailNode.execute(input),
      runAuto: (input) => container.useCases.runAutoNode.execute(input),
      runMcp: (input) => container.useCases.runMcpNode.execute(input),
      applyExecutionResult: (input) => container.useCases.applyAutoNodeResult.execute(input),
      scheduleNode: (input) => container.useCases.scheduleNodeEvent.execute(input),
      requestApproval: (session, node) =>
        raiseUnattendedApproval(
          {
            suggest: (input) => container.useCases.suggestApprover.execute(input),
            confirm: (input) => container.useCases.confirmAndSend.execute(input),
          },
          session,
          node,
        ),
      prepareConversationalStep: (session, node) => prepareConversationalStep(container, session, node),
    },
    isStepEnabled: async (userId, nodeType) => {
      const flag = flagForStep(nodeType);
      if (!flag) return true;
      const enabled = await container.useCases.isFeatureEnabledForUser.execute(
        userId,
        flag,
        await resolveIsAdmin(container, userId),
      );
      return !enabled.error && enabled.data === true;
    },
    incidents: container.useCases.notifyUnattendedIncident,
    sessionCompleteNotifier: container.useCases.notifyOnSessionComplete,
    newId: () => globalThis.crypto.randomUUID(),
    now: () => new Date(),
  });

export const buildRetryFailedStep = (container: Container): RetryFailedStep =>
  new RetryFailedStep({
    sessions: container.repos.sessions,
    advance: buildAdvanceUnattendedRun(container),
    auditLogger: container.services.auditLogger,
  });

// Fire-and-forget: the caller (a webhook answer, a poll, an approval decision)
// must not wait on a run that may call a model several times. Failures inside
// the run are recorded on the session by the driver; this only catches a crash.
export const kickUnattendedRun = (container: Container, input: AdvanceUnattendedRunInput): void => {
  void buildAdvanceUnattendedRun(container)
    .execute(input)
    .then(async (result) => {
      if (!result.error) return;
      await container.services.errorLogger.log({
        level: "error",
        message: `Unattended run could not advance: ${result.error.message}`,
        stack: result.error.cause instanceof Error ? (result.error.cause.stack ?? null) : null,
        page: "automation/unattended-run",
        metadata: { sessionId: input.sessionId, errorCode: result.error.code },
      });
    })
    .catch(async (cause: unknown) => {
      await container.services.errorLogger.log({
        level: "error",
        message: "Unattended run threw",
        stack: cause instanceof Error ? (cause.stack ?? null) : null,
        page: "automation/unattended-run",
        metadata: { sessionId: input.sessionId },
      });
    });
};

// After a person or a schedule moves a session on (an approval decision, a
// scheduled fire), hand the run back to the driver when the next step is one it
// runs — or, for an unattended run, whatever comes next, so a person's step is
// prepared and its owner told. Returns whether the driver took over.
export const continueRunAtNode = async (
  container: Container,
  sessionId: string,
  nodeId: string | null,
): Promise<boolean> => {
  if (!nodeId) return false;
  const [session, node] = await Promise.all([
    container.repos.sessions.findById(sessionId),
    container.repos.flowNodes.findById(nodeId),
  ]);
  if (session.error || !session.data || node.error || !node.data) return false;
  const runsHere = node.data.type === "ai_task" || node.data.type === "email";
  if (!runsHere && !isUnattendedOrigin(session.data.origin)) return false;
  kickUnattendedRun(container, { sessionId });
  return true;
};
