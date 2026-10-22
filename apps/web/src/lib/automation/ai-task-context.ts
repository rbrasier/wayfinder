import { renderSkillsBlock, type AiTaskNodeConfig, type ConversationalNodeConfig } from "@rbrasier/domain";
import type { RunAiTaskNodeInput } from "@rbrasier/application";
import type { getContainer } from "@/lib/container";
import { resolveIsAdmin } from "@/lib/chat/prompt-context";
import { runMcpToolPrepass } from "@/app/api/chat/[sessionId]/stream/mcp-turn-helpers";

type Container = ReturnType<typeof getContainer>;

// An AI task's skills and MCP tool results, prepared exactly as a
// conversational turn prepares them (ADR-031, ADR-032) and handed to the task's
// prompt. Each half respects its own feature flag; a failure in either leaves
// it out rather than failing the step.
export const buildAiTaskContext = async (container: Container, input: RunAiTaskNodeInput): Promise<string> => {
  const config = input.node.config as unknown as AiTaskNodeConfig;
  const userId = input.session.userId;
  const isAdmin = await resolveIsAdmin(container, userId);
  // The conversational shape is all the resolvers read: skill ids and tool refs.
  const stepTools = {
    skillRefs: config.skillRefs ?? [],
    allowedMcpToolRefs: config.allowedMcpToolRefs ?? [],
  } as unknown as ConversationalNodeConfig;

  const skillsEnabled = await container.useCases.isFeatureEnabledForUser.execute(userId, "skills", isAdmin);
  const skills =
    !skillsEnabled.error && skillsEnabled.data === true && (config.skillRefs ?? []).length > 0
      ? await container.useCases.resolveStepSkills.execute(stepTools)
      : null;
  const skillsBlock = skills && !skills.error ? renderSkillsBlock(skills.data) : "";

  const toolResults = await runMcpToolPrepass({
    container,
    nodeConfig: stepTools,
    dbMessages: input.messages,
    lastUserMessage: config.instruction,
    gatheredContext: "",
    userId,
    isAdmin,
    flowId: input.flow.id,
    sessionId: input.session.id,
    nodeId: input.node.id,
  });

  return `${skillsBlock}${toolResults}`.trim();
};
