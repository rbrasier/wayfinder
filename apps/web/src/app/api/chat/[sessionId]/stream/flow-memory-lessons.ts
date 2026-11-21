import { selectInjectableLessons, type FlowLesson, type ResolvedLesson } from "@wayfinder/domain";
import type { getContainer } from "@/lib/container";

// The accepted lessons to add to this step's prompt (ADR-057 §5). Flow memory is
// experimental in alpha-3, so nothing is injected until flow_memory is switched
// on. The flag is read globally rather than for the operator: the lessons are
// the author's, and whoever runs the flow should see the same prompt.
export const lessonsForStep = async (
  container: ReturnType<typeof getContainer>,
  acceptedLessons: FlowLesson[],
  nodeId: string | null,
): Promise<ResolvedLesson[]> => {
  const stepLessons = acceptedLessons.filter((lesson) => lesson.nodeId === nodeId);
  if (stepLessons.length === 0) return [];

  const memoryEnabled = await container.useCases.isFeatureEnabled.execute("flow_memory");
  if (memoryEnabled.error || memoryEnabled.data !== true) return [];

  return selectInjectableLessons(stepLessons);
};
