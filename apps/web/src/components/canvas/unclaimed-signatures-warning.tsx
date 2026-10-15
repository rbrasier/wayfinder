import type { UnclaimedSignatureSlot } from "@/lib/canvas/canvas-guidance";

// Named separately from the count so the copy can say which slots, on which
// step — "a signature is unsigned" is not actionable, "Supervisor Signature on
// Draft the instrument" is.
const describeSlots = (slots: UnclaimedSignatureSlot[]): string => {
  const named = slots.map((slot) => `“${slot.label}” on ${slot.stepName}`);
  if (named.length === 1) return named[0]!;
  if (named.length === 2) return `${named[0]} and ${named[1]}`;
  return `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
};

/**
 * Advisory for signature slots no approval step signs. Unlike a stranded step,
 * nothing fails at run time: the step completes, the document generates, and the
 * signature block is simply blank. That silence is the reason this warning
 * exists — the gap is only visible while the flow is being authored.
 */
export function UnclaimedSignaturesWarning({ slots }: { slots: UnclaimedSignatureSlot[] }) {
  return (
    // Mirrors DisconnectedStepsWarning: the live region stays mounted and only
    // its contents change, because a region that appears already populated is
    // announced unreliably.
    <div role="status" data-unclaimed-signatures={slots.length}>
      {slots.length > 0 && (
        <div className="rounded-[9px] border border-[#e7c200] bg-[#fff8e1] px-4 py-2.5 shadow-md">
          <p className="text-left text-[12px] leading-normal text-[#886b00]">
            ⚠ {slots.length === 1 ? "A signature has" : `${slots.length} signatures have`} nobody to
            sign {slots.length === 1 ? "it" : "them"}: {describeSlots(slots)}.{" "}
            {slots.length === 1 ? "This slot" : "These slots"} will render blank on the finished
            document.
          </p>
          <p className="mt-1 text-left text-[12px] leading-normal text-[#886b00]">
            To fix: add an <strong>Approval</strong> step after that step, open it, set{" "}
            <em>What is being approved?</em> to the step holding the signature, then choose the
            signature under <em>Which signature does this step sign?</em>. Each signature needs its
            own approval step.
          </p>
        </div>
      )}
    </div>
  );
}
