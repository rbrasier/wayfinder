import {
  ok,
  VALID_ANNOTATIONS_HINT,
  type ExtractionFieldDraft,
  type FieldProposalRequest,
  type IFieldProposer,
  type ILanguageModel,
  type ProposalDocument,
  type Result,
} from "@wayfinder/domain";
import { fieldProposalSchema, type FieldProposalData } from "@wayfinder/shared";

// How much of each document the proposer sees. Structure — headings, labels,
// table headers, the first page — is what tells it which fields matter, and it
// sits at the top. Sending whole documents would multiply cost by ten at the
// ceiling for very little extra signal.
const CHARACTERS_PER_DOCUMENT = 6_000;

const SYSTEM_PROMPT = [
  "You design extraction schemas for a document-processing tool.",
  "You are shown a sample of the documents a person has just uploaded. Work out what a person",
  "would want pulled out of every document like these, and propose that field set.",
  "",
  "Propose fields that genuinely appear across the sample, not fields you imagine such a document",
  "might contain. Prefer the specific over the generic: a tender response has a supplier name and",
  "a submitted price, not 'Field 1' and 'Other information'. Order them as they would read in a",
  "spreadsheet, with the identifying fields first.",
  "",
  "Each field carries an annotation line naming its type, written exactly as the tool's authors",
  `write them. ${VALID_ANNOTATIONS_HINT}`,
  "",
  "Mark a field (optional) when the sample shows it missing from some documents. Propose between",
  "three and fifteen fields; return fewer, or none at all, rather than padding the list.",
].join("\n");

const describeDocument = (document: ProposalDocument): string => {
  const body = document.text.slice(0, CHARACTERS_PER_DOCUMENT);
  const truncated = document.text.length > CHARACTERS_PER_DOCUMENT ? "\n[…truncated]" : "";
  return `--- ${document.filename} ---\n${body}${truncated}`;
};

const buildPrompt = (request: FieldProposalRequest): string => {
  const sections = [
    `Here ${request.documents.length === 1 ? "is 1 document" : `are ${request.documents.length} documents`} from the uploaded set:`,
    request.documents.map(describeDocument).join("\n\n"),
  ];

  if (request.guidance.trim().length > 0) {
    sections.splice(1, 0, `What the person says about these documents:\n${request.guidance.trim()}`);
  }

  // Naming what is already there keeps the proposal to what is missing. The
  // merge drops duplicates regardless, so this saves tokens rather than
  // enforcing anything.
  if (request.existingLabels.length > 0) {
    sections.push(
      `These fields already exist — do not propose them again:\n${request.existingLabels.map((label) => `- ${label}`).join("\n")}`,
    );
  }

  return sections.join("\n\n");
};

// Proposes an extraction field set from the documents themselves (ADR-059).
// Mirrors AiSeedProposer: one structured call, then best-effort post-processing
// — a malformed entry is dropped rather than failing the whole proposal, since a
// partial field set is still worth showing the author.
export class AiFieldProposer implements IFieldProposer {
  constructor(private readonly languageModel: ILanguageModel) {}

  async propose(request: FieldProposalRequest): Promise<Result<ExtractionFieldDraft[]>> {
    // No temperature is set: provider middleware strips the parameter because the
    // Claude 5 family rejects it outright (see providers.ts).
    const result = await this.languageModel.generateObject<FieldProposalData>({
      purpose: "extraction-field-proposal",
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(request),
      schema: fieldProposalSchema,
    });
    if (result.error) return result;

    return ok(this.toDrafts(result.data.object));
  }

  private toDrafts(raw: FieldProposalData): ExtractionFieldDraft[] {
    if (!Array.isArray(raw?.fields)) return [];

    const drafts: ExtractionFieldDraft[] = [];
    for (const field of raw.fields) {
      const label = typeof field?.label === "string" ? field.label.trim() : "";
      const instruction = typeof field?.instruction === "string" ? field.instruction.trim() : "";
      if (label.length === 0 || instruction.length === 0) continue;

      // A model that returns a bare label rather than an annotation line has
      // still told us the field exists; text is the safe reading of "no type
      // given", and the author can change it in one click.
      const annotation =
        typeof field?.annotation === "string" && field.annotation.trim().length > 0
          ? field.annotation.trim()
          : `${label} (text)`;

      // doneWhen is never proposed: a completion criterion is the author's
      // judgement about their own process, not something the documents say.
      drafts.push({ label, annotation, instruction, doneWhen: null });
    }
    return drafts;
  }
}
