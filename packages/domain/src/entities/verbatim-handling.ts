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
// value the model returned was genuinely copied out of one of the record's
// source documents.
//
// This is a **verification of a claim the model made**, not an inference drawn
// from the value alone. Containment on its own does not distinguish selection
// from coincidence: a composed "N/A", "None" or a surname occurs incidentally in
// any long document, and stamping such a value `verbatim` is not merely a
// mislabel — a copied value is scored on the selection scale and takes
// precedence in merge arbitration (ADR-053 §3), so a coincidence could displace
// a better-supported composed answer silently. No length floor fixes that: a
// reference code "A7" is legitimately copied at two characters, and a surname is
// eight and still incidental.
//
// So the model returns the exact characters it copied, and all four of these
// must hold before the value is `verbatim`:
//
//   1. the field can return source bytes at all (`returnsSourceBytes`)
//   2. the quote occurs byte-identically in the document the model named — not
//      in any of the record's documents, in that one
//   3. the value occurs inside that quote
//   4. that occurrence is word-bounded, so "No" inside "Notice" is not a match
//
// Steps 2 and 3 stay byte comparisons: no trimming, no case folding, no
// whitespace collapsing, each of which is precisely the transformation that
// makes a value processed rather than copied. Step 4 permits a quote that
// carries surrounding context, which is the one concession — the model quoting
// "Supplier: Acme Ltd (reg. 4482)" for the value "Acme Ltd" has still copied it.
//
// A model that composed a value does not claim to have quoted it, so the
// coincidence never arises. A claim that fails verification is simply not
// stamped: `processed` is what absence already means.
export interface VerbatimClaim {
  value: string;
  // The characters the model reported copying, as it reported them.
  quote: string;
  // The text of the document the model named — resolved by the caller, because
  // a quote verified against the wrong document verifies nothing.
  documentText: string;
  field: TemplateField;
}

// Letters, digits and underscore across every script, so a boundary check does
// not treat an accented or non-Latin character as punctuation and admit a match
// inside a longer word.
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

const isWordCharacter = (character: string): boolean => WORD_CHARACTER.test(character);

// A boundary exists wherever a word character does not sit directly against
// another word character — the standard \b rule, hand-rolled so the value needs
// no regular-expression escaping.
const occursWordBounded = (haystack: string, needle: string): boolean => {
  const firstCharacter = needle[0] ?? "";
  const lastCharacter = needle[needle.length - 1] ?? "";
  for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + 1)) {
    const before = index > 0 ? (haystack[index - 1] ?? "") : "";
    const after = haystack[index + needle.length] ?? "";
    const boundedLeft = before === "" || !isWordCharacter(before) || !isWordCharacter(firstCharacter);
    const boundedRight = after === "" || !isWordCharacter(after) || !isWordCharacter(lastCharacter);
    if (boundedLeft && boundedRight) return true;
  }
  return false;
};

export const verifyVerbatim = ({ value, quote, documentText, field }: VerbatimClaim): boolean => {
  if (value.length === 0 || quote.length === 0) return false;
  if (!returnsSourceBytes(field)) return false;
  if (!documentText.includes(quote)) return false;
  return occursWordBounded(quote, value);
};
