import { deriveFieldKey, type ExtractionFieldDraft } from "@wayfinder/domain";

// Folds an Auto Analyse proposal into the author's draft field set (ADR-059 §3).
//
// Append-and-fill, never overwrite: a field the author has touched is
// authoritative over anything the analysis proposes, so a proposal whose derived
// key already exists is dropped whole rather than merged field-by-field. This
// rule is what makes writing straight into the draft safe without a confirm
// step — the worst outcome of an unwanted analysis is extra fields to delete,
// never lost work.
//
// Keys are compared rather than labels because the key is what the schema
// actually collides on: "Supplier Name", "supplier name" and "Supplier-Name" all
// derive the same key, and parseExtractionSchema would reject the pair anyway.
export const mergeProposedFields = (
  existing: ExtractionFieldDraft[],
  proposed: ExtractionFieldDraft[],
): ExtractionFieldDraft[] => {
  const takenKeys = new Set(existing.map((field) => deriveFieldKey(field.label)));
  const additions: ExtractionFieldDraft[] = [];

  for (const field of proposed) {
    if (field.label.trim().length === 0) continue;

    const key = deriveFieldKey(field.label);
    if (takenKeys.has(key)) continue;

    takenKeys.add(key);
    additions.push(field);
  }

  return [...existing, ...additions];
};
