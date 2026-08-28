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

// Whether a field can return the characters it was given at all. Everything else
// reshapes its value by definition — a number strips currency symbols and
// separators, a date reformats, yes/no substitutes a canonical word, and an
// options field maps whatever it read to a listed value — so a value on such a
// field was composed even when its characters happen to occur in the source.
export const returnsSourceBytes = (field: TemplateField): boolean =>
  PASS_THROUGH_TYPES.has(field.type) && (field.options?.length ?? 0) === 0;

// Authoring-time check: which of a step's response fields cannot return what the
// tool sent. A verbatim-only connection whose step declares such a field is
// refused rather than run, because the step is configured to transform a result
// the administrator required be used as-is.
export const verbatimTransformViolations = (responseFields: TemplateField[]): string[] =>
  responseFields
    .filter((field) => !returnsSourceBytes(field))
    .map((field) => {
      const reason =
        (field.options?.length ?? 0) > 0
          ? "is restricted to a fixed list of options"
          : `is a "${field.type}" field`;
      return `response field "${field.key}" ${reason}, so it cannot return the tool result unchanged`;
    });

// The extraction-side counterpart to the guarantee above (ADR-053 §1): whether a
// value the model returned occurs byte-identically in one of the record's source
// texts. No trimming, no case folding, no whitespace collapsing — each of those
// is precisely the transformation that makes a value processed rather than
// copied.
//
// Containment is **necessary but not sufficient**. A caller must also establish
// that the field could have returned source bytes at all
// (`returnsSourceBytes`), because a short reshaped value collides with ordinary
// prose constantly — "No" occurs inside "Notice", and an options value inside
// any heading that happens to use the word.
//
// A blank value is never verbatim: the empty string occurs inside every text, so
// containment alone would report a field that was never filled as copied from
// the document.
export const isVerbatimIn = (value: string, sourceTexts: string[]): boolean => {
  if (value.length === 0) return false;
  return sourceTexts.some((text) => text.includes(value));
};
