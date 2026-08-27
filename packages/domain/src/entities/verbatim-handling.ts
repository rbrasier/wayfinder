import type { TemplateField } from "./template-field";

// Verbatim-only enforcement (ADR-053 §5). The guarantee is deliberately narrow:
// Wayfinder will not transform this connection's tool results — it will select
// from them or pass them through unchanged. It says nothing about whether the
// source is correct, current or unmodified upstream, which is outside what
// Wayfinder can see. The scope is Wayfinder's own handling, which is the only
// thing Wayfinder is in a position to guarantee.
//
// Within that scope verbatim means byte-identical. Truncation, whitespace
// normalisation, unit conversion and harmless tidying are all transformations.
// There is no "close enough" tier, because the moment one exists the guarantee
// stops being a byte comparison and becomes an argument. The guarantee is
// enforced by construction rather than classified after the fact: a step whose
// response fields could not return the received bytes is refused here, and the
// bytes that do get through are written by `coerceVerbatimFields`, which does
// not even trim.

// Field types that reshape whatever they are given: a number strips currency
// symbols and separators, a date reformats, yes/no substitutes a canonical word.
// Only `text` and `narrative` hand back the characters they received.
const PASS_THROUGH_TYPES = new Set(["text", "narrative"]);

// Authoring-time check: which of a step's response fields cannot return what the
// tool sent. A verbatim-only connection whose step declares such a field is
// refused rather than run, because the step is configured to transform a result
// the administrator required be used as-is.
export const verbatimTransformViolations = (responseFields: TemplateField[]): string[] =>
  responseFields
    .filter((field) => !PASS_THROUGH_TYPES.has(field.type) || (field.options?.length ?? 0) > 0)
    .map((field) => {
      const reason =
        (field.options?.length ?? 0) > 0
          ? "is restricted to a fixed list of options"
          : `is a "${field.type}" field`;
      return `response field "${field.key}" ${reason}, so it cannot return the tool result unchanged`;
    });
