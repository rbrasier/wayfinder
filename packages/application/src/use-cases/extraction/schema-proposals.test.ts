import { describe, expect, it, vi } from "vitest";
import {
  domainError,
  err,
  ok,
  startSchemaProposal,
  type ExtractionFieldDraft,
  type IDocumentExtractor,
  type ISchemaProposer,
  type SchemaProposal,
  type SchemaProposalRequest,
  type SchemaProposalOutput,
} from "@rbrasier/domain";
import { ConfirmSchemaProposal, ProposeSchema, RefineSchemaProposal } from "./schema-proposals";

const draft = (label: string, annotation = `${label} (text)`): ExtractionFieldDraft => ({
  label,
  annotation,
  instruction: `Pull the ${label.toLowerCase()}.`,
  doneWhen: null,
});

const fakeProposer = (
  ...outputs: SchemaProposalOutput[]
): ISchemaProposer & { requests: SchemaProposalRequest[] } => {
  const requests: SchemaProposalRequest[] = [];
  const queue = [...outputs];
  return {
    requests,
    propose: vi.fn(async (request: SchemaProposalRequest) => {
      requests.push(request);
      return ok(queue.shift() ?? { fields: [], note: "" });
    }),
  };
};

const failingProposer = (): ISchemaProposer => ({
  propose: vi.fn(async () => err(domainError("AI_PROVIDER_FAILED", "boom"))),
});

const proposalOf = (fields: ExtractionFieldDraft[]): SchemaProposal =>
  startSchemaProposal({ fields, request: "Draft a schema", note: "Opening set." });

const extractor = (text = "Acme Ltd — £1,200"): IDocumentExtractor => ({
  extract: vi.fn(async () => ok(text)),
});

const failingExtractor = (): IDocumentExtractor => ({
  extract: vi.fn(async () => err(domainError("VALIDATION_FAILED", "unreadable"))),
});

const sampleDocument = (filename = "bid.pdf") => ({
  id: filename,
  filename,
  treePath: filename,
  mimeType: "application/pdf",
  buffer: Buffer.from("bytes"),
});

const context = {
  flowName: "Supplier responses",
  intent: "Compare supplier bids",
  documents: [sampleDocument()],
};

describe("ProposeSchema", () => {
  it("returns a draft proposal whose fields carry types and instructions", async () => {
    const proposer = fakeProposer({
      fields: [draft("Supplier"), draft("Value", "Value (currency)")],
      note: "Two fields from the bid.",
    });

    const result = await new ProposeSchema(proposer, extractor()).execute(context);

    expect(result.error).toBeUndefined();
    expect(result.data!.proposal.status).toBe("draft");
    expect(result.data!.proposal.revisions).toHaveLength(1);
    expect(result.data!.fields.map((field) => field.annotation)).toEqual([
      "Supplier (text)",
      "Value (currency)",
    ]);
    expect(result.data!.fields.every((field) => field.instruction.length > 0)).toBe(true);
  });

  it("asks the proposer with no current fields, since there is nothing to amend yet", async () => {
    const proposer = fakeProposer({ fields: [draft("Supplier")], note: "" });

    await new ProposeSchema(proposer, extractor()).execute(context);

    expect(proposer.requests[0]!.currentFields).toEqual([]);
    expect(proposer.requests[0]!.samples).toEqual([
      { filename: "bid.pdf", text: "Acme Ltd — £1,200" },
    ]);
  });

  it("reports a proposer that emits an unparseable annotation as a finding, not an error", async () => {
    const proposer = fakeProposer({
      fields: [draft("Supplier", "Supplier (colour)")],
      note: "",
    });

    const result = await new ProposeSchema(proposer, extractor()).execute(context);

    expect(result.error).toBeUndefined();
    expect(result.data!.findings.some((finding) => finding.severity === "blocking")).toBe(true);
    // The proposal still comes back so the author can see and fix what was proposed.
    expect(result.data!.proposal.revisions).toHaveLength(1);
  });

  it("refuses more sample documents than a sample run would read", async () => {
    const proposer = fakeProposer({ fields: [draft("Supplier")], note: "" });

    const result = await new ProposeSchema(proposer, extractor()).execute({
      ...context,
      documents: [
        sampleDocument("a.pdf"),
        sampleDocument("b.pdf"),
        sampleDocument("c.pdf"),
        sampleDocument("d.pdf"),
      ],
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(proposer.propose).not.toHaveBeenCalled();
  });

  it("proposes from the stated intent when a document cannot be text-extracted", async () => {
    // An unreadable sample is not a failed proposal — the author's intent alone
    // is still something to propose from.
    const proposer = fakeProposer({ fields: [draft("Supplier")], note: "" });

    const result = await new ProposeSchema(proposer, failingExtractor()).execute(context);

    expect(result.error).toBeUndefined();
    expect(proposer.requests[0]!.samples).toEqual([{ filename: "bid.pdf", text: "" }]);
  });

  it("propagates a proposer failure as an error", async () => {
    const result = await new ProposeSchema(failingProposer(), extractor()).execute(context);

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });
});

describe("RefineSchemaProposal", () => {
  it("appends a revision and makes the refined set current", async () => {
    const proposer = fakeProposer({
      fields: [draft("Supplier"), draft("Value", "Value (currency)")],
      note: "Added the contract value.",
    });

    const result = await new RefineSchemaProposal(proposer, extractor()).execute({
      ...context,
      proposal: proposalOf([draft("Supplier")]),
      instruction: "Add the contract value",
    });

    expect(result.data!.proposal.revisions).toHaveLength(2);
    expect(result.data!.fields.map((field) => field.label)).toEqual(["Supplier", "Value"]);
    expect(result.data!.proposal.revisions[1]!.request).toBe("Add the contract value");
    expect(result.data!.proposal.revisions[1]!.note).toBe("Added the contract value.");
  });

  it("shows the proposer the set it is amending", async () => {
    const proposer = fakeProposer({ fields: [draft("Supplier")], note: "" });

    await new RefineSchemaProposal(proposer, extractor()).execute({
      ...context,
      proposal: proposalOf([draft("Supplier")]),
      instruction: "Rename it",
    });

    expect(proposer.requests[0]!.currentFields.map((field) => field.label)).toEqual(["Supplier"]);
    expect(proposer.requests[0]!.instruction).toBe("Rename it");
  });

  it("returns the current state with its findings so the panel can always render", async () => {
    const proposer = fakeProposer({
      fields: [draft("Supplier", "Supplier (colour)")],
      note: "",
    });

    const result = await new RefineSchemaProposal(proposer, extractor()).execute({
      ...context,
      proposal: proposalOf([draft("Supplier")]),
      instruction: "Break it",
    });

    expect(result.error).toBeUndefined();
    expect(result.data!.fields).toHaveLength(1);
    expect(result.data!.findings.some((finding) => finding.severity === "blocking")).toBe(true);
  });

  it("refuses to refine a proposal that has been confirmed", async () => {
    const proposer = fakeProposer({ fields: [draft("Supplier")], note: "" });
    const confirmed: SchemaProposal = { ...proposalOf([draft("Supplier")]), status: "confirmed" };

    const result = await new RefineSchemaProposal(proposer, extractor()).execute({
      ...context,
      proposal: confirmed,
      instruction: "One more change",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("ConfirmSchemaProposal", () => {
  const inputConfig = {
    cardinality: "one_per_file" as const,
    selectionCriteria: null,
    guidance: "Read each bid.",
  };
  const outputConfig = {
    format: "xlsx" as const,
    outputTemplate: null,
    instruction: "",
    generateSummary: false,
    summaryTemplate: null,
    contextDocs: [],
  };

  const saver = (result: unknown = ok({ id: "version-1" })) => ({
    execute: vi.fn().mockResolvedValue(result),
  });

  it("materialises the current fields through the schema save and closes the proposal", async () => {
    const save = saver();

    const result = await new ConfirmSchemaProposal(save as never).execute({
      flowId: "flow-1",
      proposal: proposalOf([draft("Supplier"), draft("Value", "Value (currency)")]),
      input: inputConfig,
      output: outputConfig,
    });

    expect(result.error).toBeUndefined();
    expect(result.data!.proposal.status).toBe("confirmed");
    expect(result.data!.versionId).toBe("version-1");
    // The drafts go through the ordinary save, so a proposed field and a
    // hand-typed field end up identical (ADR-052).
    const saved = save.execute.mock.calls[0]![0];
    expect(saved.flowId).toBe("flow-1");
    expect(saved.schema.fields.map((field: ExtractionFieldDraft) => field.label)).toEqual([
      "Supplier",
      "Value",
    ]);
  });

  it("refuses while a blocking finding is open, and writes nothing", async () => {
    const save = saver();

    const result = await new ConfirmSchemaProposal(save as never).execute({
      flowId: "flow-1",
      proposal: proposalOf([draft("Supplier", "Supplier (colour)")]),
      input: inputConfig,
      output: outputConfig,
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(save.execute).not.toHaveBeenCalled();
  });

  it("refuses a second confirm rather than re-materialising over hand-edited fields", async () => {
    const save = saver();
    const confirmed: SchemaProposal = { ...proposalOf([draft("Supplier")]), status: "confirmed" };

    const result = await new ConfirmSchemaProposal(save as never).execute({
      flowId: "flow-1",
      proposal: confirmed,
      input: inputConfig,
      output: outputConfig,
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(save.execute).not.toHaveBeenCalled();
  });

  it("leaves nothing behind when the snapshot write fails", async () => {
    // There is no stored proposal state to become inconsistent with the flow,
    // so a failed write means the author simply confirms again.
    const save = saver(err(domainError("DB_ERROR", "write failed")));

    const result = await new ConfirmSchemaProposal(save as never).execute({
      flowId: "flow-1",
      proposal: proposalOf([draft("Supplier")]),
      input: inputConfig,
      output: outputConfig,
    });

    expect(result.error?.code).toBe("DB_ERROR");
  });
});
