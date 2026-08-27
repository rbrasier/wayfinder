// The verbatim-only setting's copy and its confirmation step, as decisions
// separate from the markup that renders them.
//
// Every string here is scoped to Wayfinder's own handling. The setting says
// Wayfinder will not transform this connection's results; it says nothing about
// whether the source is correct, current or healthy, which Wayfinder cannot see
// (ADR-053 §5). Copy that implied otherwise would be the real risk in this
// feature — the enforcement itself is a byte comparison.

export const VERBATIM_SCOPE_NOTE =
  "Wayfinder will use this connection's results as it received them, selecting from them rather " +
  "than rewriting them. It does not check the source: a wrong or out-of-date value in the system " +
  "behind this connection is outside what Wayfinder can see.";

// Both directions are confirmed. Turning it off removes a governance constraint
// an administrator deliberately put in place, which is the change most worth
// pausing over — a confirmation only on the way on would be the wrong half.
export const verbatimConfirmPrompt = (label: string, turningOn: boolean): string =>
  turningOn
    ? `Turn on verbatim-only handling for "${label}"? Wayfinder will stop rewriting this connection's results, and steps that reshape them will be refused.`
    : `Turn off verbatim-only handling for "${label}"? Wayfinder will be free to rewrite this connection's results again.`;

export const verbatimBadge = (verbatimOnly: boolean): string | null =>
  verbatimOnly ? "Verbatim only" : null;
