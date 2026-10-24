import type { getContainer } from "@/lib/container";
import type { ToolActivityListener } from "@/app/api/chat/[sessionId]/stream/mcp-turn-helpers";

type Container = ReturnType<typeof getContainer>;

// A step that runs with no chat turn streaming — an AI task, or the opener of a
// step an unattended run hands to a person — has no stream to report its tool
// lookups on, so it tells anyone watching the chat over the session event bus.
// Best-effort: a failed publish only costs the label.
export const publishStepActivity =
  (container: Container, sessionId: string, nodeId: string): ToolActivityListener =>
  (sources) => {
    void container.services.sessionEvents.publish(sessionId, {
      type: "step.activity",
      nodeId,
      sources: [...(sources ?? [])],
    });
  };
