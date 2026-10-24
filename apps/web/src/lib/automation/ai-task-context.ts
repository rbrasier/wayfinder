import {
  renderSkillsBlock,
  type AiTaskNodeConfig,
  type ConversationalNodeConfig,
  type SessionTriggerPayload,
} from "@rbrasier/domain";
import type { RunAiTaskNodeInput } from "@rbrasier/application";
import type { getContainer } from "@/lib/container";
import { resolveIsAdmin } from "@/lib/chat/prompt-context";
import { runMcpToolPrepass } from "@/app/api/chat/[sessionId]/stream/mcp-turn-helpers";
import { buildGatheredContext } from "@/app/api/chat/[sessionId]/stream/turn-helpers";
import { publishStepActivity } from "./step-activity";

type Container = ReturnType<typeof getContainer>;

// Enough of the item a run started from for the tools to find it again by its
// identifiers, without handing the loop a whole API response.
const RUN_ITEM_BUDGET_CHARS = 4000;

const asText = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

// What the run was started with, for the tool loop: an AI task has no chat to
// read its identifiers from, so without this it could not look anything up.
const describeRunInputs = (payload: SessionTriggerPayload | null | undefined): string => {
  if (!payload) return "";
  const inputs = Object.entries(payload.inputs).map(([key, value]) => `- ${key}: ${asText(value)}`);
  const item =
    payload.raw === undefined || payload.raw === null
      ? []
      : [`- Started with: ${asText(payload.raw).slice(0, RUN_ITEM_BUDGET_CHARS)}`];
  return [...inputs, ...item].join("\n");
};

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

  const knownContext = [describeRunInputs(input.session.triggerPayload), buildGatheredContext(input.messages)]
    .filter((part) => part.length > 0)
    .join("\n");
  const toolPrepass = await runMcpToolPrepass({
    container,
    nodeConfig: stepTools,
    dbMessages: input.messages,
    lastUserMessage: config.instruction,
    stepBrief: config.instruction,
    gatheredContext: knownContext,
    userId,
    isAdmin,
    flowId: input.flow.id,
    sessionId: input.session.id,
    nodeId: input.node.id,
    onActivity: publishStepActivity(container, input.session.id, input.node.id),
  });
  await toolPrepass.recordAudit();
  const toolResultsBlock = toolPrepass.toolResults
    ? `\n\n<tool_results>\nLooked up for this task with its tools. Use them in your result.\n${toolPrepass.toolResults}\n</tool_results>`
    : "";

  return `${skillsBlock}${toolResultsBlock}`.trim();
};
