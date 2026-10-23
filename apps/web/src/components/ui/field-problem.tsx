"use client";

// Why a form cannot be saved yet, shown directly above the field it is about
// rather than in a list at the foot of the dialog, where it was easy to miss
// and hard to match to a field. The form scrolls to the first of these
// and focuses the control that names it in `aria-describedby`.
export function FieldProblemText({ id, messages }: { id: string; messages: readonly string[] }) {
  if (messages.length === 0) return null;
  return (
    <div id={id} data-field-problem className="space-y-0.5 text-[12px] font-medium text-[#b42318]">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}

// Outlines a control while it has a problem; pairs with `aria-invalid`.
export const INVALID_OUTLINE = "aria-invalid:border-[#b42318]";

// Takes the form to the first problem: scrolls it into view and focuses the
// control it describes. Waits two frames so a section that opens to reveal the
// problem (Advanced) has rendered open first.
export const revealFirstProblem = (container: HTMLElement | null) => {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const problem = container?.querySelector<HTMLElement>("[data-field-problem]");
      if (!problem) return;
      problem.scrollIntoView({ block: "center", behavior: "smooth" });
      container
        ?.querySelector<HTMLElement>(`[aria-describedby~="${problem.id}"]`)
        ?.focus({ preventScroll: true });
    }),
  );
};
