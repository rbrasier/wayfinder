// Every tool a step allows is described to the model before it replies, so a
// long list costs time on every turn and blurs which tool fits. Past this many
// the editor suggests trimming; it never blocks saving.
export const RECOMMENDED_MAX_STEP_TOOLS = 8;

export const toolCountAdvice = (toolCount: number): string | null =>
  toolCount > RECOMMENDED_MAX_STEP_TOOLS
    ? `This step has ${toolCount} tools. More than ${RECOMMENDED_MAX_STEP_TOOLS} makes it slower to reply and likelier to pick the wrong one — keep only the tools this step needs.`
    : null;
