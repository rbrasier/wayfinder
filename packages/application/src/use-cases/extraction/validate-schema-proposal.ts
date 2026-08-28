import {
  buildExtractionField,
  validateStructuredFieldSet,
  type ExtractionField,
  type ExtractionFieldDraft,
  type SchemaProposalFinding,
  type TemplateFieldType,
} from "@rbrasier/domain";

// Only free text has a length to cap; every other type either reformats what it
// is given or is bounded by its own value space.
const LENGTH_CAPPED_TYPES = new Set<TemplateFieldType>(["text", "narrative"]);

// Only numeric types have an ordering for a bound to sit on.
const BOUNDED_TYPES = new Set<TemplateFieldType>(["number", "currency"]);

const blocking = (fieldLabel: string | null, message: string): SchemaProposalFinding => ({
  severity: "blocking",
  fieldLabel,
  message,
});

const advisory = (fieldLabel: string | null, message: string): SchemaProposalFinding => ({
  severity: "advisory",
  fieldLabel,
  message,
});

// Constraints the parser accepts syntactically but which cannot mean anything on
// the declared type. `parseTemplateField` applies each annotation independently,
// so `(yesno) (maxlen: 10)` parses cleanly and then caps the length of a value
// that can only ever be "Yes" or "No".
const constraintFindings = (
  label: string,
  field: ExtractionField["field"],
): SchemaProposalFinding[] => {
  const findings: SchemaProposalFinding[] = [];
  if (field.maxLength !== undefined && !LENGTH_CAPPED_TYPES.has(field.type)) {
    findings.push(
      blocking(
        label,
        `"${label}" is a "${field.type}" field with a (maxlen: …) — a length cap only means something on a text field.`,
      ),
    );
  }
  if ((field.max !== undefined || field.min !== undefined) && !BOUNDED_TYPES.has(field.type)) {
    findings.push(
      blocking(
        label,
        `"${label}" is a "${field.type}" field with a (min: …) or (max: …) — a numeric bound only means something on a number or currency field.`,
      ),
    );
  }
  return findings;
};

const adviceFindings = (label: string, field: ExtractionField["field"]): SchemaProposalFinding[] => {
  const findings: SchemaProposalFinding[] = [];
  if (field.type === "narrative") {
    findings.push(
      advisory(
        label,
        `"${label}" is a narrative field, so the AI composes its prose rather than copying it from the source. It can never be reported as verbatim.`,
      ),
    );
  }
  if (field.options?.length === 1) {
    findings.push(
      advisory(
        label,
        `"${label}" offers a single option, which records a constant rather than a choice. Add the other values or use a text field.`,
      ),
    );
  }
  return findings;
};

// Blocking findings are the coherence checks the field model can actually decide
// (ADR-052 §4); advisory ones are worth saying and never stop a confirm. Every
// field is checked rather than stopping at the first failure — the author is
// refining a whole set, and one problem per turn would make the conversation as
// long as the number of mistakes.
export const validateSchemaProposal = (
  fields: ExtractionFieldDraft[],
): SchemaProposalFinding[] => {
  if (fields.length === 0) {
    return [blocking(null, "A proposal needs at least one field before it can be confirmed.")];
  }

  const findings: SchemaProposalFinding[] = [];
  const built: ExtractionField[] = [];
  const seenKeys = new Set<string>();

  for (const draft of fields) {
    const label = draft.label.trim() || draft.annotation.trim();
    const field = buildExtractionField(draft);
    if (field.error) {
      findings.push(blocking(label, field.error.message));
      continue;
    }

    const key = field.data.field.key;
    if (seenKeys.has(key)) {
      findings.push(
        blocking(
          label,
          `"${label}" resolves to the key "${key}", which another field already uses. Give each field a distinct name.`,
        ),
      );
      continue;
    }
    seenKeys.add(key);
    built.push(field.data);
    findings.push(...constraintFindings(label, field.data.field));
    findings.push(...adviceFindings(label, field.data.field));
  }

  // The same function the conversational structured path uses, called rather
  // than re-implemented, so the two sets of rejections cannot drift (§7).
  const structured = validateStructuredFieldSet(built.map((field) => field.field));
  if (structured.error) findings.push(blocking(null, structured.error.message));

  return findings;
};
