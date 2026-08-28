import {
  appendProposalRevision,
  confirmProposal,
  currentProposalFields,
  domainError,
  err,
  ok,
  SAMPLE_MAX_DOCUMENTS,
  startSchemaProposal,
  type ExtractionFieldDraft,
  type ExtractionInputConfig,
  type ExtractionOutputConfig,
  type IDocumentExtractor,
  type ISchemaProposer,
  type Result,
  type SchemaProposal,
  type SchemaProposalFinding,
  type SchemaProposalSample,
} from "@rbrasier/domain";
import type { SaveExtractionSchema } from "../flow/extraction-authoring";
import type { SampleInputDocument } from "./run-sample-extraction";
import { validateSchemaProposal } from "./validate-schema-proposal";

// What the proposer needs to know about the flow it is proposing for. The
// documents are the same author-supplied sample buffers `RunSampleExtraction`
// takes, reaching this use case through the same author-gated route — the
// proposer reads no content the caller could not already read, and opens no
// second path to it (phase §10).
export interface SchemaProposalContext {
  flowName: string;
  intent: string;
  documents: SampleInputDocument[];
  userId?: string | null;
  flowId?: string | null;
}

// Text extraction is best-effort per document, as it is for a sample run: an
// extractor error leaves that document with no text rather than failing the
// proposal, since a proposer can still work from the author's stated intent and
// whatever else was readable.
const extractSamples = async (
  documentExtractor: IDocumentExtractor,
  documents: SampleInputDocument[],
): Promise<SchemaProposalSample[]> => {
  const samples: SchemaProposalSample[] = [];
  for (const document of documents) {
    const extracted = await documentExtractor.extract({
      buffer: document.buffer,
      mimeType: document.mimeType,
    });
    samples.push({ filename: document.filename, text: extracted.error ? "" : extracted.data });
  }
  return samples;
};

// The same ceiling a sample run enforces. A proposal reads the same kind of
// material for the same reason, so it gets the same bound rather than a second
// one that could drift.
const tooManyDocuments = (documents: SampleInputDocument[]): boolean =>
  documents.length > SAMPLE_MAX_DOCUMENTS;

const documentCapError = () =>
  err(
    domainError(
      "VALIDATION_FAILED",
      `A schema proposal reads at most ${SAMPLE_MAX_DOCUMENTS} sample documents. Reduce the selection.`,
    ),
  );

// Every read returns the current state alongside its findings, so the panel can
// always render what stands rather than having to ask again after a turn that
// produced problems.
export interface SchemaProposalView {
  proposal: SchemaProposal;
  fields: ExtractionFieldDraft[];
  findings: SchemaProposalFinding[];
}

const viewOf = (proposal: SchemaProposal): SchemaProposalView => {
  const fields = currentProposalFields(proposal);
  return { proposal, fields, findings: validateSchemaProposal(fields) };
};

// The opening proposal. A proposer that emits an unparseable annotation produces
// a reported finding rather than a failure: the author needs to see what was
// proposed in order to argue with it, and a proposal is never authoritative.
export class ProposeSchema {
  constructor(
    private readonly proposer: ISchemaProposer,
    private readonly documentExtractor: IDocumentExtractor,
  ) {}

  async execute(context: SchemaProposalContext): Promise<Result<SchemaProposalView>> {
    if (tooManyDocuments(context.documents)) return documentCapError();

    const proposed = await this.proposer.propose({
      flowName: context.flowName,
      intent: context.intent,
      samples: await extractSamples(this.documentExtractor, context.documents),
      currentFields: [],
      instruction: context.intent,
      userId: context.userId,
      flowId: context.flowId,
    });
    if (proposed.error) return proposed;

    return ok(
      viewOf(
        startSchemaProposal({
          fields: proposed.data.fields,
          request: context.intent,
          note: proposed.data.note,
        }),
      ),
    );
  }
}

export interface RefineSchemaProposalInput extends SchemaProposalContext {
  proposal: SchemaProposal;
  instruction: string;
}

// One refinement turn. The proposal travels with the request because it is
// thread-local state the caller holds (ADR-052 §1) — there is no repository to
// load it from and none should be added.
export class RefineSchemaProposal {
  constructor(
    private readonly proposer: ISchemaProposer,
    private readonly documentExtractor: IDocumentExtractor,
  ) {}

  async execute(input: RefineSchemaProposalInput): Promise<Result<SchemaProposalView>> {
    if (tooManyDocuments(input.documents)) return documentCapError();

    const proposed = await this.proposer.propose({
      flowName: input.flowName,
      intent: input.intent,
      samples: await extractSamples(this.documentExtractor, input.documents),
      currentFields: currentProposalFields(input.proposal),
      instruction: input.instruction,
      userId: input.userId,
      flowId: input.flowId,
    });
    if (proposed.error) return proposed;

    const refined = appendProposalRevision(input.proposal, {
      fields: proposed.data.fields,
      request: input.instruction,
      note: proposed.data.note,
    });
    if (refined.error) return refined;

    return ok(viewOf(refined.data));
  }
}

export interface ConfirmSchemaProposalInput {
  flowId: string;
  proposal: SchemaProposal;
  input: ExtractionInputConfig;
  output: ExtractionOutputConfig;
}

export interface ConfirmedSchema {
  proposal: SchemaProposal;
  versionId: string;
}

// Confirmation is the single moment a proposal crosses into authoring config,
// and it is one write. The drafts go through the ordinary schema save — the same
// `buildExtractionField` path a hand-typed field takes — so there is no
// AI-authored field variant, and a failed write leaves nothing behind because
// nothing about the proposal was stored to become inconsistent with it.
export class ConfirmSchemaProposal {
  constructor(private readonly saveSchema: SaveExtractionSchema) {}

  async execute(input: ConfirmSchemaProposalInput): Promise<Result<ConfirmedSchema>> {
    const fields = currentProposalFields(input.proposal);
    const confirmed = confirmProposal(input.proposal, validateSchemaProposal(fields));
    if (confirmed.error) return confirmed;

    const saved = await this.saveSchema.execute({
      flowId: input.flowId,
      schema: { fields, input: input.input, output: input.output },
    });
    if (saved.error) return saved;

    return ok({ proposal: confirmed.data, versionId: saved.data.id });
  }
}
