import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";
import { deriveFieldKey, parseTemplateField, type TemplateField } from "./template-field";

// The multi-tag half of the template grammar: walking a document's ordered tags
// into a field set, folding {{#name (repeat)}} blocks into groups, and resolving
// the references that only make sense across tags. The single-tag grammar lives
// in `template-field.ts`; these are the rules a tag cannot check on its own.

interface OpenGroup {
  field: TemplateField;
  inner: TemplateField[];
  innerKeys: Set<string>;
}

// Binds one approval comment to the signature it names, or to the template's
// only signature when it named none.
//
// The bare form is deliberately bounded to a lone signature, for the reason
// ADR-043 §5 bounds the lone-slot fallback: with two or more signatures on a
// document, guessing would print one approver's words under another approver's
// name — worse than refusing the template outright, because nobody would see it
// until the document was signed.
const bindApprovalComment = (
  field: TemplateField,
  signatures: TemplateField[],
): Result<TemplateField> => {
  const available = signatures.map((signature) => `"${signature.label}"`).join(", ");

  if (!field.signatureLabel) {
    if (signatures.length === 1) return ok({ ...field, signatureLabel: signatures[0]!.label });
    if (signatures.length === 0) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Tag "{{${field.raw}}}" is an approval comment, but this template has no signature for it to belong to. Add one, e.g. {{ Delegate Signature (approval) }}.`,
        ),
      );
    }
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Tag "{{${field.raw}}}" does not say which signature it belongs to, and this template has ${signatures.length}: ${available}. Name one, e.g. {{ ${field.label} (approval-comment: ${signatures[0]!.label}) }}.`,
      ),
    );
  }

  const slotKey = deriveFieldKey(field.signatureLabel);
  const signature = signatures.find((candidate) => candidate.key === slotKey);
  if (!signature) {
    const suggestion =
      signatures.length > 0
        ? ` This template's signatures are: ${available}.`
        : ` Add it, e.g. {{ ${field.signatureLabel} (approval) }}.`;
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Tag "{{${field.raw}}}" belongs to a signature called "${field.signatureLabel}", which this template does not have.${suggestion}`,
      ),
    );
  }

  // Stored as the signature's own label rather than the reference as typed, so a
  // differently-spelled but equivalent reference re-serialises as the tag it
  // points at instead of drifting further from it on each edit.
  return ok({ ...field, signatureLabel: signature.label });
};

// Resolves every approval comment against the signatures the same template
// declares. Run after the whole tag list is walked, because a comment tag may
// sit above the signature it names — a rationale box over a signature block is
// the ordinary layout, and an order-dependent binding would reject it.
const bindApprovalComments = (fields: TemplateField[]): Result<TemplateField[]> => {
  if (!fields.some((field) => field.type === "approval_comment")) return ok(fields);

  const signatures = fields.filter((field) => field.type === "signature");
  const bound: TemplateField[] = [];
  for (const field of fields) {
    if (field.type !== "approval_comment") {
      bound.push(field);
      continue;
    }
    const resolved = bindApprovalComment(field, signatures);
    if (resolved.error) return resolved;
    bound.push(resolved.data);
  }
  return ok(bound);
};

// Walks the ordered raw tags, folding {{#name (repeat)}} … {{/name}} blocks into
// a single `group` field whose `itemFields` are the inner tags (kept out of the
// top level). A {{#name}} without (repeat) stays a v1.19.0 boolean gate with its
// inner tags at the top level. Nesting a group inside a section or another group
// (or a section inside a group) is a validation error — v1 is single-level only.
export const parseTemplateFields = (rawTags: string[]): Result<TemplateField[]> => {
  const fields: TemplateField[] = [];
  const seenKeys = new Set<string>();
  let openGroup: OpenGroup | null = null;
  const openSections: string[] = [];

  const addTopLevel = (field: TemplateField): void => {
    if (seenKeys.has(field.key)) return;
    seenKeys.add(field.key);
    fields.push(field);
  };

  for (const rawTag of rawTags) {
    const trimmed = rawTag.trim();
    const sigil = /^[#/^]/.test(trimmed) ? trimmed[0] : null;
    const parsed = parseTemplateField(trimmed);
    if (parsed.error) return parsed;
    const field = parsed.data;

    if (sigil === "#" || sigil === "^") {
      if (field.type === "group") {
        if (openGroup) {
          return err(
            domainError(
              "VALIDATION_FAILED",
              `Repeating group "{{${trimmed}}}" is nested inside another group. Nested groups are not supported — keep groups at the top level.`,
            ),
          );
        }
        if (openSections.length > 0) {
          return err(
            domainError(
              "VALIDATION_FAILED",
              `Repeating group "{{${trimmed}}}" is nested inside an optional section. A group cannot sit inside a section — move it out.`,
            ),
          );
        }
        openGroup = { field, inner: [], innerKeys: new Set<string>() };
        addTopLevel(field);
        continue;
      }
      if (openGroup) {
        return err(
          domainError(
            "VALIDATION_FAILED",
            `Section "{{${trimmed}}}" is nested inside a repeating group. Sections inside groups are not supported.`,
          ),
        );
      }
      openSections.push(field.key);
      addTopLevel(field);
      continue;
    }

    if (sigil === "/") {
      if (openGroup && openGroup.field.key === field.key) {
        if (openGroup.inner.length === 0) {
          return err(
            domainError(
              "VALIDATION_FAILED",
              `Repeating group "{{#${field.label}}}" has no fields inside it. Add at least one {{ Field }} between the open and close tags.`,
            ),
          );
        }
        openGroup.field.itemFields = openGroup.inner;
        openGroup = null;
        continue;
      }
      const sectionIndex = openSections.lastIndexOf(field.key);
      if (sectionIndex >= 0) openSections.splice(sectionIndex, 1);
      // Close tags never emit a field — they dedupe against their open by key.
      continue;
    }

    if (openGroup) {
      // A signature is a single attested act, not a repeating item — inside a
      // group it would imply N decisions from one approval (ADR-043 §1). Its
      // comment belongs to that same one decision, so it cannot repeat either.
      if (field.type === "signature" || field.type === "approval_comment") {
        const description = field.type === "signature" ? "Signature" : "Approval comment";
        return err(
          domainError(
            "VALIDATION_FAILED",
            `${description} "{{${trimmed}}}" is inside the repeating group "${openGroup.field.label}". An approval is one attested decision, so it must sit outside any (repeat) block.`,
          ),
        );
      }
      if (!openGroup.innerKeys.has(field.key)) {
        openGroup.innerKeys.add(field.key);
        openGroup.inner.push(field);
      }
      continue;
    }
    addTopLevel(field);
  }

  return bindApprovalComments(fields);
};
