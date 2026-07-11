import {
  ok,
  type Flow,
  type FlowEdge,
  type FlowNode,
  type Result,
  type Session,
  type SessionMessage,
} from "@rbrasier/domain";
import { branchChoiceSchema } from "@rbrasier/shared";
import type { getContainer } from "@/lib/container";
import {
  applyAdvanceSideEffects,
  buildGatheredContext,
} from "@/app/api/chat/[sessionId]/stream/turn-helpers";

type Container = ReturnType<typeof getContainer>;

// Lives in lib/chat rather than under app/api/.../stream because it is called
// from the tRPC session router; the previous location put a route-directory
// symbol into a non-HTTP layer (E16 in the code-quality phase).

// Recomputes the branch choice for a forked confirmation step at Proceed time,
// because the operator may have chatted further since the threshold was reached
// (ADR-026). Returns null for a single edge or when the model cannot decide.
async function recomputeBranchChoice(
  container: Container,
  session: Session,
  nodes: FlowNode[],
  edges: FlowEdge[],
  messages: SessionMessage[],
): Promise<string | null> {
  const outgoingEdges = edges.filter((e) => e.fromNodeId === session.currentNodeId);
  if (outgoingEdges.length <= 1) return null;

  const branchNodeIds = outgoingEdges.map((e) => e.toNodeId);
  const branchNodes = nodes
    .filter((node) => branchNodeIds.includes(node.id))
    .map((node) => {
      const config = node.config as { doneWhen?: string; aiInstruction?: string; instruction?: string };
      const doneWhenPurpose =
        config.doneWhen && config.doneWhen !== "__TEMPLATE_COMPLETE__" ? config.doneWhen : undefined;
      const purpose = doneWhenPurpose ?? config.aiInstruction ?? config.instruction;
      return { id: node.id, name: node.name, purpose };
    });

  const branchPromptResult = container.services.sessionAgent.buildBranchChoicePrompt({ branchNodes });
  if (branchPromptResult.error) return null;

  const aiConfig = await container.runtimeConfig.getAiConfig();
  const branchingModelName = aiConfig.models.branching;

  const coreMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
  }));

  const branchResult = await container.services.llm.generateObject<{ branchChoice?: string }>({
    purpose: "chat-branch-choice",
    userId: session.userId,
    flowId: session.flowId,
    sessionId: session.id,
    model: branchingModelName,
    schema: branchChoiceSchema,
    system: branchPromptResult.data,
    messages: coreMessages,
  });
  if (branchResult.error) return null;

  return branchResult.data.object.branchChoice ?? null;
}

export interface ConfirmStepInput {
  container: Container;
  session: Session;
  flow: Flow;
  nodes: FlowNode[];
  edges: FlowEdge[];
  messages: SessionMessage[];
  confirmedByUserId: string;
  isAdmin: boolean;
}

export interface ConfirmStepResult {
  advanced: boolean;
  // A forked step whose branch could not be resolved — the UI opens the manual
  // branch-override path instead of silently failing.
  needsManualBranch: boolean;
  newNodeId: string | null;
}

// Orchestrates an operator Proceed: recompute the branch for a fork, run the
// ConfirmStepAdvance use-case, then fire the shared advance side effects so the
// outcome matches auto-advance (ADR-026).
export async function confirmStep(input: ConfirmStepInput): Promise<Result<ConfirmStepResult>> {
  const { container, session, flow, nodes, edges, messages, confirmedByUserId, isAdmin } = input;

  const completedNode = nodes.find((node) => node.id === session.currentNodeId);
  if (!session.currentNodeId || !completedNode) {
    return ok({ advanced: false, needsManualBranch: false, newNodeId: null });
  }

  const branchChoice = await recomputeBranchChoice(container, session, nodes, edges, messages);

  const advanceResult = await container.useCases.confirmStepAdvance.execute({
    sessionId: session.id,
    nodeId: session.currentNodeId,
    branchChoice,
    confirmedByUserId,
  });
  if (advanceResult.error) return advanceResult;

  const { advanced, newNodeId, needsManualBranch } = advanceResult.data;
  if (!advanced) {
    return ok({ advanced, needsManualBranch, newNodeId });
  }

  const orgSettingResult = await container.repos.systemSettings.get("organisation_name");
  const organisationName = orgSettingResult.error ? null : (orgSettingResult.data?.value ?? null);

  const globalInstructionsResult = await container.repos.systemSettings.get("global_prompt");
  const globalInstructions = globalInstructionsResult.error
    ? null
    : (globalInstructionsResult.data?.value ?? null);

  const userResult = await container.repos.users.findById(confirmedByUserId);
  const userProfile =
    userResult.error || !userResult.data
      ? null
      : { name: userResult.data.name, role: userResult.data.role, team: userResult.data.team };

  const aiConfig = await container.runtimeConfig.getAiConfig();

  await applyAdvanceSideEffects({
    container,
    session: advanceResult.data.session,
    flow,
    nodes,
    completedNode,
    newNodeId,
    fallbackMessages: messages,
    gatheredContext: buildGatheredContext(messages),
    organisationName,
    userProfile,
    userId: confirmedByUserId,
    isAdmin,
    modelName: aiConfig.models.branching,
    globalInstructions,
  });

  return ok({ advanced, needsManualBranch, newNodeId });
}
