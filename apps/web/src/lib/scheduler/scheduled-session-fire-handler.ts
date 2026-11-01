import { generateObject } from "ai";
import { recordTokenUsage, resolveModel } from "@wayfinder/adapters";
import {
  buildBranchDescriptors,
  domainError,
  err,
  ok,
  type FlowEdge,
  type FlowNode,
  type IScheduleFireHandler,
  type Result,
  type SessionMessage,
  type SessionSchedule,
} from "@wayfinder/domain";
import { branchChoiceSchema } from "@wayfinder/shared";
import type { getContainer } from "@/lib/container";
import { toBranchChoiceMessages } from "@/lib/chat/branch-choice-messages";
import { continueRunAtNode } from "@/lib/automation/unattended-runs";
import {
  resolveGlobalInstructions,
  resolveIsAdmin,
  resolveOrganisationName,
  resolveUserProfile,
  resolveUserRole,
} from "@/lib/chat/prompt-context";
import {
  buildGatheredContext,
  dispatchAutoNode,
  generateInitialMessage,
  isAutoNodeEnabled,
} from "@/app/api/chat/[sessionId]/stream/turn-helpers";
import {
  dispatchScheduledNode,
  isScheduledNodeEnabled,
} from "@/app/api/chat/[sessionId]/stream/scheduled-node-dispatch";

type Container = ReturnType<typeof getContainer>;

// The real fire effect: advance the parked session past the fired scheduled node
// and generate the next step's opening message, reusing the same turn machinery
// the chat stream uses. Forks are resolved with the branch-choice model.
export class ScheduledSessionFireHandler implements IScheduleFireHandler {
  constructor(private readonly container: Container) {}

  async fire(schedule: SessionSchedule): Promise<Result<void>> {
    const sessionResult = await this.container.useCases.getSession.execute(schedule.sessionId);
    if (sessionResult.error) return err(sessionResult.error);
    if (!sessionResult.data) {
      return err(domainError("NOT_FOUND", "Session not found for schedule."));
    }

    const { session, flow, nodes, edges, messages } = sessionResult.data;

    const outgoing = edges.filter((edge) => edge.fromNodeId === schedule.nodeId);
    const aiConfig = await this.container.runtimeConfig.getAiConfig();
    const provider = aiConfig.provider;
    const branchingModel = resolveModel(provider, aiConfig.models.branching, aiConfig.apiKeys[provider]);

    let branchChoice: string | null = null;
    if (outgoing.length > 1) {
      const picked = await this.pickBranch(schedule, nodes, outgoing, messages, branchingModel, {
        provider,
        modelName: aiConfig.models.branching,
        userId: session.userId,
      });
      if (picked.error) return picked;
      branchChoice = picked.data;
    }

    const advance = await this.container.useCases.advanceScheduledNode.execute({
      sessionId: schedule.sessionId,
      scheduledNodeId: schedule.nodeId,
      branchChoice,
    });
    if (advance.error) return advance;

    // `stale` (session moved on/closed) and `completed` (no next step) are both
    // successful, terminal fires — there is no next message to generate.
    if (advance.data.status !== "advanced" || !advance.data.session || !advance.data.newNodeId) {
      return ok(undefined);
    }

    const newNodeId = advance.data.newNodeId;
    const newNode = nodes.find((node) => node.id === newNodeId);
    if (!newNode) return err(domainError("NOT_FOUND", "Next node not found after advance."));

    if (await continueRunAtNode(this.container, schedule.sessionId, newNodeId)) return ok(undefined);

    const advancedSession = advance.data.session;
    const gatheredContext = buildGatheredContext(messages);
    const ownerIsAdmin = await resolveIsAdmin(this.container, session.userId);

    if (
      newNode.type === "scheduled" &&
      (await isScheduledNodeEnabled(this.container, session.userId, ownerIsAdmin))
    ) {
      await dispatchScheduledNode({ container: this.container, session: advancedSession, flow, node: newNode, messages });
      return ok(undefined);
    }

    if (
      newNode.type === "auto" &&
      (await isAutoNodeEnabled(this.container, session.userId, ownerIsAdmin))
    ) {
      await dispatchAutoNode({
        container: this.container,
        session: advancedSession,
        flow,
        node: newNode,
        messages,
        userId: session.userId,
        userRole: await resolveUserRole(this.container, session.userId),
      });
      return ok(undefined);
    }

    await generateInitialMessage({
      container: this.container,
      sessionId: session.id,
      newNodeId,
      newNode,
      flow,
      modelName: aiConfig.models.branching,
      organisationName: await resolveOrganisationName(this.container),
      userProfile: await resolveUserProfile(this.container, session.userId),
      userId: session.userId,
      isAdmin: ownerIsAdmin,
      gatheredContext,
      globalInstructions: await resolveGlobalInstructions(this.container),
    });
    return ok(undefined);
  }

  private async pickBranch(
    schedule: SessionSchedule,
    nodes: FlowNode[],
    outgoing: FlowEdge[],
    messages: SessionMessage[],
    model: ReturnType<typeof resolveModel>,
    usage: { provider: string; modelName: string; userId: string },
  ): Promise<Result<string>> {
    const branchNodes = buildBranchDescriptors(nodes, outgoing);

    const promptResult = this.container.services.sessionAgent.buildBranchChoicePrompt({ branchNodes });
    if (promptResult.error) return err(promptResult.error);

    const coreMessages = toBranchChoiceMessages(messages);

    const branchResult = await generateObject({
      model,
      schema: branchChoiceSchema,
      system: promptResult.data,
      messages: coreMessages,
    }).catch(() => null);

    if (!branchResult) {
      return err(domainError("AGENT_FAILED", "Branch-choice model call failed for scheduled fire."));
    }

    recordTokenUsage(
      this.container.repos.usageRepo,
      {
        purpose: "chat-branch-choice",
        userId: usage.userId,
        conversationId: schedule.sessionId,
        model: usage.modelName,
        provider: usage.provider as Parameters<typeof recordTokenUsage>[1]["provider"],
      },
      {
        promptTokens: branchResult.usage.inputTokens ?? 0,
        completionTokens: branchResult.usage.outputTokens ?? 0,
        systemTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    );

    const choice = branchResult.object.branchChoice;
    if (!choice || !outgoing.some((edge) => edge.toNodeId === choice)) {
      return err(domainError("AGENT_FAILED", "Branch-choice model returned an invalid node."));
    }
    return ok(choice);
  }
}
