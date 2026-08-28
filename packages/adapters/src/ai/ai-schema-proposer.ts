import {
  ok,
  type ExtractionFieldDraft,
  type ILanguageModel,
  type ISchemaProposer,
  type Result,
  type SchemaProposalOutput,
  type SchemaProposalRequest,
  type SchemaProposalSample,
} from "@rbrasier/domain";
import { z } from "zod";

// Per sample document. A proposer only needs to see enough of a document to work
// out what fields it carries, and the field names are almost always near the
// front; without a cap one long PDF would consume the whole call.
export const SAMPLE_TEXT_CHARACTER_CAP = 6000;

const proposalSchema = z.object({
  note: z
    .string()
    .describe("One or two sentences saying what you proposed or changed, and why."),
  fields: z.array(
    z.object({
      label: z.string().describe("The field's human-readable name, e.g. \"Contract Value\"."),
      annotation: z
        .string()
        .describe(
          "The full annotation line: the label followed by its type and any constraints, e.g. \"Contract Value (currency)\" or \"Signed On (date) (optional)\".",
        ),
      instruction: z
        .string()
        .describe("Plain-English instruction telling the extractor what to pull for this field."),
      doneWhen: z
        .string()
        .nullable()
        .describe("How to tell this field is satisfactorily filled, or null."),
    }),
  ),
});

interface ProposedField {
  label?: unknown;
  annotation?: unknown;
  instruction?: unknown;
  doneWhen?: unknown;
}

const SYSTEM_PROMPT = [
  "You propose the field set for a document-extraction schema, for a human to review and refine.",
  "You never decide anything: your proposal is a draft that a person confirms or argues with.",
  "Write each field as an annotation line in the authoring language:",
  'a label followed by its type and constraints — "Contract Value (currency)", "Signed On (date) (optional)", "Status (options: Draft, Final)".',
  "Valid annotations: (text), (date), (currency), (number), (email), (yesno), (options: A, B, C), (multi-options: A, B, C), (multiple), (maxlen: N), (max: N), (min: N), (optional).",
  "Do not use (section) or (approval): they belong to document templates, not to extraction.",
  "Only put (maxlen: N) on a text field, and (min: N)/(max: N) on a number or currency field.",
  "Give every field a plain-English instruction saying what to pull and where to look for it.",
  "Propose fields the sample documents actually support — a field nothing in the source can fill is worse than a missing one.",
  "Give each field a distinct name: names are lowercased and snake-cased into keys, so \"Supplier Name\" and \"supplier name\" collide.",
].join(" ");

const truncate = (text: string): string =>
  text.length <= SAMPLE_TEXT_CHARACTER_CAP
    ? text
    : `${text.slice(0, SAMPLE_TEXT_CHARACTER_CAP)}\n… (truncated)`;

const describeSample = (sample: SchemaProposalSample): string =>
  `[${sample.filename}]\n${truncate(sample.text)}`;

const describeCurrentFields = (fields: ExtractionFieldDraft[]): string =>
  fields
    .map((field) => `- ${field.annotation} — ${field.instruction}`)
    .join("\n");

// The model proposes text; it never gets to decide the field model. An entry
// missing any of the three parts a draft needs is dropped rather than emitted
// half-formed, where it would surface to the author as a parser error about a
// field they never saw proposed.
const sanitiseFields = (proposed: ProposedField[]): ExtractionFieldDraft[] => {
  const fields: ExtractionFieldDraft[] = [];
  for (const entry of proposed) {
    if (typeof entry?.label !== "string" || entry.label.trim().length === 0) continue;
    if (typeof entry.annotation !== "string" || entry.annotation.trim().length === 0) continue;
    if (typeof entry.instruction !== "string" || entry.instruction.trim().length === 0) continue;
    const doneWhen = typeof entry.doneWhen === "string" ? entry.doneWhen.trim() : "";
    fields.push({
      label: entry.label.trim(),
      annotation: entry.annotation.trim(),
      instruction: entry.instruction.trim(),
      doneWhen: doneWhen.length > 0 ? doneWhen : null,
    });
  }
  return fields;
};

// Proposes an extraction field set over the language model, mirroring
// `AiSeedProposer`. The opening proposal and every refinement turn are the same
// call: the current field set is shown back so the proposer amends what stands
// rather than being asked to remember it.
export class AiSchemaProposer implements ISchemaProposer {
  constructor(private readonly languageModel: ILanguageModel) {}

  async propose(request: SchemaProposalRequest): Promise<Result<SchemaProposalOutput>> {
    const current = describeCurrentFields(request.currentFields);
    const prompt = [
      `Flow: "${request.flowName}".`,
      `What the author needs to capture: ${request.intent}`,
      current
        ? `The field set as it stands:\n${current}\n\nWhat to change about it: ${request.instruction}`
        : `Propose the opening field set. ${request.instruction}`,
      request.samples.length > 0
        ? `Sample source documents:\n\n${request.samples.map(describeSample).join("\n\n")}`
        : "No sample documents were provided; propose from the stated intent alone.",
      "Return the complete field set you are proposing, not only the fields you changed.",
    ].join("\n\n");

    const result = await this.languageModel.generateObject<{
      note?: unknown;
      fields?: unknown;
    }>({
      purpose: "schema-proposal",
      userId: request.userId,
      flowId: request.flowId,
      system: SYSTEM_PROMPT,
      prompt,
      schema: proposalSchema,
    });
    if (result.error) return result;

    const object = result.data.object;
    const proposed = Array.isArray(object?.fields) ? (object.fields as ProposedField[]) : [];
    return ok({
      fields: sanitiseFields(proposed),
      note: typeof object?.note === "string" ? object.note : "",
    });
  }
}
