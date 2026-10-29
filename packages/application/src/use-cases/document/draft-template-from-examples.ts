import {
  applyTextEdits,
  captionBefore,
  contextAround,
  countExamplesLacking,
  countOccurrences,
  draftFieldToTemplateField,
  err,
  locateExactOccurrence,
  ok,
  originalPositionOf,
  resolveCaptionAnchor,
  splitChoices,
  templateFieldToLine,
  valueAfterCaption,
  type DraftEvidence,
  type IDocumentGenerator,
  type ILanguageModel,
  type Result,
  type TemplateAnnotationEdit,
  type TemplateDraftField,
  type TemplateField,
  type TextEditLink,
} from "@wayfinder/domain";
import { templateDraftExtractionSchema, templateDraftVerificationSchema } from "@wayfinder/shared";

export interface DraftTemplateFromExamplesInput {
  baseBytes: Buffer;
  // The base example's extracted text — the only example the model sees.
  baseText: string;
  // Every other example's extracted text, used only by code: to tell a value
  // that varies from boilerplate, and to collect multi-select choices.
  otherTexts: string[];
  userId?: string | null;
  flowId?: string | null;
}

export interface DraftedField {
  field: TemplateField;
  // The canonical `Label (annotations)` line, serialised here so it always parses.
  line: string;
  // The base-document text the edit targets, and which copy of it.
  sourceText: string;
  occurrence: number;
  insertAfter: boolean;
  replacedValue: string;
  context: string;
  evidence: DraftEvidence;
}

export interface UndraftedValue {
  label: string;
  sourceValue: string;
  reason: "not-in-document" | "could-not-place";
}

export interface DraftComparison {
  originalText: string;
  taggedText: string;
  links: TextEditLink[];
}

export interface DraftTemplateFromExamplesOutput {
  fields: DraftedField[];
  // Dropped because every example carries the same text — restorable by the
  // author, since a coincidence (one supplier for every contract) looks the same.
  sameInEveryExample: DraftedField[];
  unplaced: UndraftedValue[];
  comparison: DraftComparison;
  // Held by the browser for download only; the save route re-annotates the base.
  taggedDocument: Buffer;
}

const FIELD_RULES = [
  "Rules:",
  "- `sourceValue` must be the answer, never the caption naming it. A form pairs a",
  "  caption with the value someone entered: the caption stays in the document and",
  "  only the value is replaced. Word extracts one table cell per line, so a",
  "  caption and its value read as consecutive lines — \"Employee Name\" then",
  "  \"Richard Brasier\". There `label` is \"Employee Name\" and `sourceValue` is",
  "  \"Richard Brasier\".",
  "- `sourceValue` must appear on a single line below, character for character.",
  "  A value you cannot copy exactly is discarded.",
  "- `occurrence` is the zero-based index of that value among identical copies.",
  "- `label` is a short Title Case name with no brackets or annotations.",
  "- Use `options` when the value is drawn from a fixed set. A value that is itself",
  "  a short comma- or slash-separated list (e.g. \"Mobile phone, Laptop\") IS such a",
  "  set — return each candidate as an option, with `multiple: true` when more than",
  "  one could apply at once.",
  "- Use `narrative` only for a paragraph an AI should compose, not a value.",
  "- Do not propose headings, clause text or standard terms.",
  "- Propose nothing rather than guessing. An empty list is a valid answer.",
];

const extractionPrompt = (documentText: string): string =>
  [
    "You are helping a business user turn a filled-in example of a document into a",
    "reusable template. Decide which text is a value that changes each time the",
    "document is written, and which is boilerplate that stays.",
    "",
    ...FIELD_RULES,
    "",
    "Document:",
    "---",
    documentText,
    "---",
  ].join("\n");

const verificationPrompt = (taggedText: string): string =>
  [
    "This document is a template being drafted from a filled-in example. Values",
    "already turned into fields show as {{ Field Name }} placeholders.",
    "List only literal values that still look specific to this one example and",
    "carry no placeholder yet. Never list a placeholder or anything inside one.",
    "",
    ...FIELD_RULES,
    "",
    "Document:",
    "---",
    taggedText,
    "---",
  ].join("\n");

interface Candidate {
  draft: TemplateDraftField;
  // Position in the base text where the model's value was found.
  position: number;
  evidence: "extraction" | "checking-pass";
}

interface Placement extends DraftedField {
  start: number;
  end: number;
}

const overlaps = (placement: { start: number; end: number }, claimed: Placement[]): boolean =>
  claimed.some((other) => placement.start < other.end && other.start < placement.end);

const tagFor = (line: string): string => `{{ ${line} }}`;

const replacementFor = (placement: Placement): string =>
  placement.insertAfter ? `${placement.sourceText} ${tagFor(placement.line)}` : tagFor(placement.line);

// Drafts a template from filled examples (ADR-066): the model extracts fields,
// code decides where each placeholder lands, and a checking pass may only add.
// The document is edited once, by annotate(), as plain text substitutions
// inside its existing runs — it is never rebuilt, so its formatting survives.
export class DraftTemplateFromExamples {
  constructor(
    private readonly languageModel: ILanguageModel,
    private readonly documentGenerator: IDocumentGenerator,
  ) {}

  async execute(input: DraftTemplateFromExamplesInput): Promise<Result<DraftTemplateFromExamplesOutput>> {
    const extraction = await this.languageModel.generateObject<{ fields: TemplateDraftField[] }>({
      purpose: "template-draft-extract",
      prompt: extractionPrompt(input.baseText),
      schema: templateDraftExtractionSchema,
      userId: input.userId ?? null,
      flowId: input.flowId ?? null,
    });
    if (extraction.error) return err(extraction.error);

    const extracted = extraction.data.object.fields ?? [];
    const reservedLabels = extracted.map((draft) => draft.label);
    const unplaced: UndraftedValue[] = [];
    const candidates: Candidate[] = [];

    for (const draft of extracted) {
      const position = locateExactOccurrence(input.baseText, draft.sourceValue, draft.occurrence);
      if (position === null) {
        unplaced.push({ label: draft.label, sourceValue: draft.sourceValue, reason: "not-in-document" });
        continue;
      }
      candidates.push({ draft, position, evidence: "extraction" });
    }

    const placed: Placement[] = [];
    const sameInEveryExample: Placement[] = [];
    this.placeAll(candidates, input, reservedLabels, placed, sameInEveryExample);

    const additions = await this.checkingPass(input, placed, reservedLabels);
    this.placeAll(additions, input, reservedLabels, placed, sameInEveryExample);

    const annotated = this.documentGenerator.annotate({
      templateBytes: input.baseBytes,
      edits: placed.map((placement) => this.editFor(placement)),
    });
    if (annotated.error) return err(annotated.error);

    const refused = new Set(annotated.data.unmatched.map((edit) => `${edit.find}#${edit.occurrence}`));
    const applied = placed.filter((placement) => !refused.has(`${placement.sourceText}#${placement.occurrence}`));
    for (const placement of placed) {
      if (applied.includes(placement)) continue;
      unplaced.push({
        label: placement.field.label,
        sourceValue: placement.replacedValue,
        reason: "could-not-place",
      });
    }

    const tagged = applyTextEdits(
      input.baseText,
      applied.map((placement) => ({
        start: placement.start,
        end: placement.end,
        replacement: replacementFor(placement),
        fieldKey: placement.field.key,
      })),
    );

    return ok({
      fields: applied.map(withoutSpan),
      sameInEveryExample: sameInEveryExample.map(withoutSpan),
      unplaced,
      comparison: { originalText: input.baseText, taggedText: tagged.text, links: tagged.links },
      taggedDocument: annotated.data.bytes,
    });
  }

  // The checking pass reads the text as it will be once tagged, so the
  // placeholders already placed are visible and it can only point at what is
  // left. Its positions are mapped back onto the base text; anything inside a
  // placeholder has no original and is discarded. A failure here costs only
  // the additions, never the fields already drafted.
  private async checkingPass(
    input: DraftTemplateFromExamplesInput,
    placed: Placement[],
    reservedLabels: string[],
  ): Promise<Candidate[]> {
    const tagged = applyTextEdits(
      input.baseText,
      placed.map((placement) => ({
        start: placement.start,
        end: placement.end,
        replacement: replacementFor(placement),
        fieldKey: placement.field.key,
      })),
    );

    const verification = await this.languageModel.generateObject<{ fields: TemplateDraftField[] }>({
      purpose: "template-draft-verify",
      prompt: verificationPrompt(tagged.text),
      schema: templateDraftVerificationSchema,
      userId: input.userId ?? null,
      flowId: input.flowId ?? null,
    });
    if (verification.error) return [];

    const additions: Candidate[] = [];
    for (const draft of verification.data.object.fields ?? []) {
      const taggedPosition = locateExactOccurrence(tagged.text, draft.sourceValue, draft.occurrence);
      if (taggedPosition === null) continue;
      const position = originalPositionOf(tagged.links, taggedPosition);
      if (position === null) continue;
      if (input.baseText.slice(position, position + draft.sourceValue.length) !== draft.sourceValue) continue;

      reservedLabels.push(draft.label);
      additions.push({
        draft: { ...draft, occurrence: countOccurrences(input.baseText.slice(0, position), draft.sourceValue) },
        position,
        evidence: "checking-pass",
      });
    }
    return additions;
  }

  private placeAll(
    candidates: Candidate[],
    input: DraftTemplateFromExamplesInput,
    reservedLabels: string[],
    placed: Placement[],
    sameInEveryExample: Placement[],
  ): void {
    const ordered = [...candidates].sort((a, b) => a.position - b.position);

    for (const candidate of ordered) {
      const placement = this.place(candidate, input, reservedLabels);
      if (!placement) continue;
      if (overlaps(placement, placed) || overlaps(placement, sameInEveryExample)) continue;

      if (this.isSameInEveryExample(placement, input)) {
        sameInEveryExample.push(placement);
        continue;
      }
      placed.push(placement);
    }
  }

  private place(candidate: Candidate, input: DraftTemplateFromExamplesInput, reservedLabels: string[]): Placement | null {
    const anchor = resolveCaptionAnchor({
      documentText: input.baseText,
      sourceText: candidate.draft.sourceValue,
      position: candidate.position,
      label: candidate.draft.label,
      reservedLabels,
    });

    const draft = { ...candidate.draft, options: this.choicesFor(candidate.draft, anchor.position, input, reservedLabels) };
    const field = draftFieldToTemplateField(draft);
    if (!field) return null;

    const start = anchor.position;
    const end = start + anchor.sourceText.length;

    return {
      field,
      line: templateFieldToLine(field),
      sourceText: anchor.sourceText,
      occurrence: anchor.occurrence,
      insertAfter: anchor.insertAfter,
      replacedValue: anchor.sourceText,
      context: contextAround(input.baseText, start, end),
      evidence: this.evidenceFor(candidate, anchor.insertAfter, anchor.sourceText, input),
      start,
      end,
    };
  }

  private evidenceFor(
    candidate: Candidate,
    insertAfter: boolean,
    value: string,
    input: DraftTemplateFromExamplesInput,
  ): DraftEvidence {
    if (candidate.evidence === "checking-pass") return { kind: "checking-pass" };
    if (insertAfter) return { kind: "blank-in-example" };
    if (input.otherTexts.length === 0) return { kind: "single-example" };
    return {
      kind: "varies",
      differsIn: countExamplesLacking(value, input.otherTexts),
      of: input.otherTexts.length,
    };
  }

  // A caption placement has no value to compare, and with one example there is
  // nothing to compare against — only a real value with other examples can be
  // judged boilerplate.
  private isSameInEveryExample(placement: Placement, input: DraftTemplateFromExamplesInput): boolean {
    if (placement.insertAfter || input.otherTexts.length === 0) return false;
    return countExamplesLacking(placement.sourceText, input.otherTexts) === 0;
  }

  // The other examples are never shown to the model, so a multi-select's
  // choices from them are read by code: the value after the same caption.
  private choicesFor(
    draft: TemplateDraftField,
    position: number,
    input: DraftTemplateFromExamplesInput,
    reservedLabels: string[],
  ): string[] {
    if (draft.options.length === 0 || input.otherTexts.length === 0) return draft.options;

    const caption = captionBefore(input.baseText, position);
    if (!caption) return draft.options;

    const choices = [...draft.options];
    for (const text of input.otherTexts) {
      const value = valueAfterCaption(caption, text, reservedLabels);
      if (!value) continue;
      for (const choice of splitChoices(value)) {
        if (!choices.includes(choice)) choices.push(choice);
      }
    }
    return choices;
  }

  private editFor(placement: Placement): TemplateAnnotationEdit {
    return {
      find: placement.sourceText,
      occurrence: placement.occurrence,
      replacement: replacementFor(placement),
    };
  }
}

const withoutSpan = ({ start, end, ...drafted }: Placement): DraftedField => {
  void start;
  void end;
  return drafted;
};
