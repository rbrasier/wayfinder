import { generateObject } from "ai";
import { recordTokenUsage, resolveModel } from "@rbrasier/adapters";
import {
  domainError,
  err,
  ok,
  type FlowNode,
  type IScheduleFireHandler,
  type PromptUserProfile,
  type Result,
  type SessionMessage,
  type SessionSchedule,
} from "@rbrasier/domain";
import { branchChoiceSchema } from "@rbrasier/shared";
import type { getContainer } from "@/lib/container";
import {
  buildGatheredContext,
  dispatchAutoNode,
  dispatchScheduledNode,
  generateInitialMessage,
  isAutoNodeEnabled,
  isScheduledNodeEnabled,
} from "@/app/api/chat/[sessionId]/stream/turn-helpers";

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

    const advancedSession = advance.data.session;
    const gatheredContext = buildGatheredContext(messages);

    if (newNode.type === "scheduled" && (await isScheduledNodeEnabled(this.container))) {
      await dispatchScheduledNode({ container: this.container, session: advancedSession, flow, node: newNode, messages });
      return ok(undefined);
    }

    if (newNode.type === "auto" && (await isAutoNodeEnabled(this.container))) {
      await dispatchAutoNode({
        container: this.container,
        session: advancedSession,
        flow,
        node: newNode,
        messages,
        userId: session.userId,
        userRole: await this.resolveUserRole(session.userId),
      });
      return ok(undefined);
    }

    await generateInitialMessage({
      container: this.container,
      sessionId: session.id,
      newNodeId,
      newNode,
      flow,
      model: branchingModel,
      organisationName: await this.resolveOrganisationName(),
      userProfile: await this.resolveUserProfile(session.userId),
      userId: session.userId,
      provider,
      gatheredContext,
    });
    return ok(undefined);
  }

  private async pickBranch(
    schedule: SessionSchedule,
    nodes: FlowNode[],
    outgoing: { toNodeId: string }[],
    messages: SessionMessage[],
    model: ReturnType<typeof resolveModel>,
    usage: { provider: string; modelName: string; userId: string },
  ): Promise<Result<string>> {
    const branchNodes = outgoing.map((edge) => {
      const node = nodes.find((candidate) => candidate.id === edge.toNodeId);
      const config = node?.config as { doneWhen?: string; aiInstruction?: string; instruction?: string };
      const doneWhenPurpose =
        config?.doneWhen && config.doneWhen !== "__TEMPLATE_COMPLETE__" ? config.doneWhen : undefined;
      return {
        id: edge.toNodeId,
        name: node?.name ?? edge.toNodeId,
        purpose: doneWhenPurpose ?? config?.aiInstruction ?? config?.instruction,
      };
    });

    const promptResult = this.container.services.sessionAgent.buildBranchChoicePrompt({ branchNodes });
    if (promptResult.error) return err(promptResult.error);

    const coreMessages = messages.map((message) => ({
      role: message.role as "user" | "assistant" | "system",
      content: message.content,
    }));

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
        promptTokens: branchResult.usage.promptTokens ?? 0,
        completionTokens: branchResult.usage.completionTokens ?? 0,
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

  private async resolveOrganisationName(): Promise<string | null> {
    const setting = await this.container.repos.systemSettings.get("organisation_name");
    return setting.error ? null : (setting.data?.value ?? null);
  }

  private async resolveUserProfile(userId: string): Promise<PromptUserProfile | null> {
    const user = await this.container.repos.users.findById(userId);
    if (user.error || !user.data) return null;
    return { name: user.data.name, role: user.data.role, team: user.data.team };
  }

  private async resolveUserRole(userId: string): Promise<"admin" | "user"> {
    const user = await this.container.repos.users.findById(userId);
    if (user.error || !user.data) return "user";
    return user.data.role === "admin" ? "admin" : "user";
  }
}
