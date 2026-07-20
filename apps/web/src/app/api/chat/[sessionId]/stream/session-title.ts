import type { getContainer } from "@/lib/container";

type Container = ReturnType<typeof getContainer>;

// The provisional title a fresh chat carries until the operator has actually
// said something. The kickoff message is a generic auto-sent opener with no user
// intent, so a title generated from it is meaningless (item 6).
export const placeholderSessionTitle = (flowName: string): string => `${flowName} (new)`;

// Decides the session title as a chat progresses. `priorUserMessageCount` is the
// number of persisted user messages *before* the current turn:
//   0 → this is the kickoff turn; set the "{Flow} (new)" placeholder.
//   1 → this is the first real user message; generate a title from it, unless the
//        operator already renamed the chat away from the placeholder.
// Any later turn leaves the title untouched. Best-effort: failures are swallowed.
export async function maybeUpdateSessionTitle(
  container: Container,
  session: { id: string; title: string | null },
  flowName: string,
  priorUserMessageCount: number,
  latestUserMessage: string,
  modelName: string,
  userId: string,
): Promise<void> {
  if (priorUserMessageCount === 0) {
    await container.repos.sessions
      .update(session.id, { title: placeholderSessionTitle(flowName) })
      .catch(() => undefined);
    return;
  }
  if (priorUserMessageCount !== 1) return;
  // Respect a manual rename made between the kickoff and the first real message.
  if (session.title !== null && session.title !== placeholderSessionTitle(flowName)) return;
  await generateTitle(container, session.id, latestUserMessage, modelName, userId);
}

// Routed through the ILanguageModel port so usage recording, quota enforcement,
// the concurrency governor, and Langfuse tracing all apply as decorators
// (ADR-026) — no hand-rolled recordTokenUsage or direct SDK call here.
// Best-effort: any failure (including a quota block) falls back to a truncated
// slice of the first user message.
export async function generateTitle(
  container: Container,
  sessionId: string,
  firstUserMessage: string,
  modelName: string,
  userId: string,
): Promise<void> {
  const result = await container.services.llm.generateText({
    purpose: "chat-title",
    userId,
    sessionId,
    model: modelName,
    system:
      "Generate a concise title (max 80 characters) for a workflow session based on the user's first message. Return only the title, no quotes or punctuation.",
    prompt: firstUserMessage,
    maxTokens: 30,
  });
  const generated = result.error ? "" : result.data.text.trim().slice(0, 80);
  const title = generated || firstUserMessage.slice(0, 80);
  if (title) {
    await container.repos.sessions.update(sessionId, { title }).catch(() => undefined);
  }
}
