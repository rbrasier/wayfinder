import {
  buildFieldConstraintsText,
  type ExtractionField,
  type FlowContextDoc,
} from "@rbrasier/domain";
import { buildContextDocsSection } from "../document/structured-fields";

export interface BuildExtractionSystemPromptInput {
  fields: ExtractionField[];
  // The author's "how should the AI read these documents?" guidance.
  guidance: string;
  // Flow-level context material that guides extraction (the equivalent of the
  // conversational node's whole-flow context) — grounded on, never questioned.
  contextDocs: FlowContextDoc[];
}

const buildFieldInstructionsBlock = (fields: ExtractionField[]): string =>
  fields
    .map((field) => {
      const requirement = field.field.optional ? "optional" : "required";
      const doneWhen = field.doneWhen ? ` Done when: ${field.doneWhen}` : "";
      return `- "${field.field.label}" (key: ${field.field.key}) [${requirement}]: ${field.instruction}${doneWhen}`;
    })
    .join("\n");

// The extraction system prompt, adapted from the conversational node's structure
// (flow-session-graph): an expert <role>, the author's reading guidance,
// <field_formats> that ask the model to silently reformat values to each field's
// required format, per-field <field_instructions>, and the grounding rules that
// keep it from inventing values. Unlike the conversational node it never asks
// the operator questions — it works only from the source documents and the
// context material. This is the single source of truth shared by the extraction
// runtime and the authoring "view system prompt" preview.
export const buildExtractionSystemPrompt = (input: BuildExtractionSystemPromptInput): string => {
  const templateFields = input.fields.map((field) => field.field);
  const guidance = input.guidance.trim();

  const roleBlock = `<role>
  You are a meticulous data-extraction specialist. You read the source documents provided and pull out exactly the fields defined below, formatting each to its required format. You work only from the documents and the context material given to you — you never guess, infer beyond what the text supports, or draw on outside knowledge, and you never ask questions. When a value is not clearly supported by the source, you leave it blank.
</role>`;

  const guidanceBlock = guidance
    ? `\n\n<how_to_read_documents>\n  ${guidance}\n</how_to_read_documents>`
    : "";

  // Unlike the conversational node, extraction reads third-party documents whose
  // date convention it does not control, so it cannot simply assert day-first —
  // that would fix a UK-origin source and corrupt a US-origin one. It anchors its
  // own output format, then reasons about the source, and routes a genuinely
  // undetermined order to the low-confidence band for human review. The 30-45
  // range clears EXTRACTION_CONFIDENCE_FLOOR (below which applyConfidenceFloor
  // blanks the value) and sits under AMBER_THRESHOLD, so it bands red.
  const fieldFormatsBlock = `\n\n<field_formats>
  Each field has a required format. When the source gives you information for a field, silently reformat it into the required format yourself whenever you reasonably can — for example, turn "next Tuesday" or "3rd of June" into DD-MM-YYYY, or "twelve hundred dollars" into $1,200.00. For (options) fields, map what the source says to the closest listed value. Never invent a value to satisfy a format — leave it blank when it is genuinely absent.

  Dates need particular care, because the source documents may not use the same convention you write. The format you output is always day-first: in DD-MM-YYYY the first number is the day and the second is the month, so 10 August 2026 is written 10-08-2026, never 08-10-2026. Work out which number is the day and which is the month before you reformat:
  - A month written in words ("10 Aug 2026") or an ISO date ("2026-08-10") is already unambiguous — read it directly.
  - A component above 12 settles the order by itself: in "13/08/2026" the 13 can only be the day.
  - Otherwise look for corroboration in the same document — a date spelled out elsewhere, a covering letter, or another date whose order is already settled.
  - If the order is still genuinely undetermined, such as a bare "08/10/2026" in a document that never spells a date out, do not guess silently. Give your best reading, set a confidence between 30 and 45, and state in the rationale that the day/month order could not be determined from the source. A flagged value gets reviewed by a person; a confidently wrong date does not.

  Never swap a day and month to make a date look more plausible.

${buildFieldConstraintsText(templateFields)}
</field_formats>`;

  const instructionsBlock = `\n\n<field_instructions>\n${buildFieldInstructionsBlock(input.fields)}\n</field_instructions>`;

  const rulesBlock = `\n\n<extraction_rules>
  - Ground every value in the source documents or the context material. Never invent, extrapolate beyond the text, or carry over an example value from a template.
  - For each field return { value, confidence (0-100), rationale }. Set confidence to how sure you are the value is correct and grounded in the source; use an empty value and confidence 0 when the information is genuinely absent.
  - Required fields must be filled only when the information is present in the source. If a required field is genuinely absent, still leave it blank rather than guessing — a blank required field is a signal for a human to review, an invented one is a hallucination.
  - Return an entry for every field key, even when the value is blank.
  - When you copied a value straight out of a document, also return sourceRef: { document, locator, quote } — "document" named exactly as it appears in the record source documents, "locator" the position inside it (a page number, a section heading, a table cell reference or a line), and "quote" the exact characters you copied it from, reproduced byte for byte: same spelling, case, spacing and punctuation. The quote must contain the value and must appear in that document verbatim; a short surrounding phrase is fine, a paraphrase is not.
  - Omit sourceRef entirely when you composed, reformatted or reworded the value rather than copying it, and when you cannot point to a specific place. It is optional and never worth inventing — a quote that does not match the document is treated as no quote at all.
  - Do not paraphrase a value you could copy. Where the source already carries the value in the required format, return those exact characters — an unnecessary rewording loses the record that the value was read rather than composed.
</extraction_rules>`;

  const contextBlock = buildContextDocsSection(input.contextDocs);
  const contextSection = contextBlock ? `\n${contextBlock}` : "";

  return `${roleBlock}${guidanceBlock}${fieldFormatsBlock}${instructionsBlock}${rulesBlock}${contextSection}`;
};
