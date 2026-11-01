import type { TurnStreamWriter } from "@wayfinder/domain";
import type { getContainer } from "@/lib/container";

type Container = ReturnType<typeof getContainer>;

// What the readiness gate tells the user, on both outcomes. Split from
// `turn-helpers` to keep that module under the file-size budget, and because
// these six exports are one idea: the gate speaks for itself rather than leaving
// it to the model's next reply.

export const CROSS_CHECK_PASS_NOTE =
  "Cross-check complete — everything is in alignment with the reference documents.";

// Streamed the moment the cross-check passes, so the user gets explicit
// feedback before the (slow) branch choice and document generation run. Opens a
// new bubble first so the note never merges into the reply above it.
export function writeCrossCheckPassNote(writer: TurnStreamWriter): void {
  writer.endBubble();
  writer.writeText(CROSS_CHECK_PASS_NOTE);
}

// Persisted separately from the streamed note (and after the assistant turn)
// so the stored order matches what streamed: reply first, then the note.
// Best-effort: a failure here must not block the advance.
export async function persistCrossCheckPassNote(
  container: Container,
  sessionId: string,
  stepNodeId: string | null,
): Promise<void> {
  await container.repos.sessionMessages
    .create({ sessionId, role: "system", content: CROSS_CHECK_PASS_NOTE, stepNodeId })
    .catch(() => undefined);
}

// The counterpart to the pass note, and the reason it exists: the fail path used
// to stream only a model-written follow-up, which is free to soften or omit what
// the review actually found. The user was told the step was not done without
// being told what was missing. This says it plainly, before the model speaks.
export const buildCrossCheckGapNote = (missingInformation: string[]): string => {
  if (missingInformation.length === 0) {
    return "Cross-check complete — some details in your answers still need to be confirmed before this step can be marked complete.";
  }
  const items = missingInformation.map((item) => `- ${item}`).join("\n");
  return `Cross-check complete — these still need to be confirmed before this step can be marked complete:\n\n${items}`;
};

// Opens a new bubble first so the note never merges into the reply it overrules.
export function writeCrossCheckGapNote(
  writer: TurnStreamWriter,
  missingInformation: string[],
): void {
  writer.endBubble();
  writer.writeText(buildCrossCheckGapNote(missingInformation));
}

// Best-effort, like its passing counterpart: losing the note must not cost the
// user the corrective follow-up that comes after it.
export async function persistCrossCheckGapNote(
  container: Container,
  sessionId: string,
  stepNodeId: string | null,
  missingInformation: string[],
): Promise<void> {
  await container.repos.sessionMessages
    .create({
      sessionId,
      role: "system",
      content: buildCrossCheckGapNote(missingInformation),
      stepNodeId,
    })
    .catch(() => undefined);
}
