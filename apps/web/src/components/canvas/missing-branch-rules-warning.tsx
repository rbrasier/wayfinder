import type { ForkMissingBranchRule } from "@/lib/canvas/canvas-guidance";
import { BranchRuleIcon } from "./branch-rule-icon";

// Named steps rather than a bare count, matching the unclaimed-signature
// advisory: "a branch has no rule" is not actionable, "Triage" is.
const describeForks = (forks: ForkMissingBranchRule[]): string => {
  const named = forks.map((fork) => `“${fork.stepName}”`);
  if (named.length === 1) return named[0]!;
  if (named.length === 2) return `${named[0]} and ${named[1]}`;
  return `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
};

/**
 * Advisory for a step that splits into several next steps without saying when to
 * take each one. Nothing fails at run time — the AI still picks a branch, but
 * from each destination step's own description, which says what that step does
 * rather than when the workflow should go there. That silent guess is only
 * visible while the flow is being authored, which is what makes this a canvas
 * warning rather than a runtime one.
 */
export function MissingBranchRulesWarning({ forks }: { forks: ForkMissingBranchRule[] }) {
  const missingTotal = forks.reduce((total, fork) => total + fork.missingCount, 0);

  return (
    // Mirrors DisconnectedStepsWarning: the live region stays mounted and only
    // its contents change, because a region that appears already populated is
    // announced unreliably.
    <div role="status" data-missing-branch-rules={missingTotal}>
      {forks.length > 0 && (
        <div className="rounded-[9px] border border-[#e7c200] bg-[#fff8e1] px-4 py-2.5 shadow-md">
          <p className="text-left text-[12px] leading-normal text-[#886b00]">
            ⚠ {forks.length === 1 ? "A step splits" : `${forks.length} steps split`} into several
            next steps without saying when to take each one: {describeForks(forks)}.{" "}
            {missingTotal === 1 ? "One connector is" : `${missingTotal} connectors are`} marked with{" "}
            <BranchRuleIcon
              state="missing"
              className="inline-block h-3.5 w-3.5 -translate-y-px align-middle"
            />{" "}
            on the canvas. Click a marked connector and describe when the workflow should take that
            path — until you do, the AI has to guess from the next step&apos;s own description.
          </p>
        </div>
      )}
    </div>
  );
}
