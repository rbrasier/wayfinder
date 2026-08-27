import type { Container } from "./container";
import { unwrap } from "./e2e-fixtures";

const SEED_EXTRACTION_FLOW_NAME = "E2E SEED Extraction Flow";
const DOCUMENT_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Two supplier files, one record each, holding exactly the character classes the
// CSV writer has to survive: a comma in an address, a quoted clause, and a line
// break inside a rationale. A download that opens but splits these apart is the
// failure the export exists to prevent, so the fixture carries them rather than
// leaving the browser test to assert on tidy values.
const SEED_DOCUMENTS = [
  { filename: "acme-invoice.docx", treePath: "acme/acme-invoice.docx" },
  { filename: "globex-invoice.docx", treePath: "globex/globex-invoice.docx" },
] as const;

const SEED_RECORD_FIELDS = [
  [
    { key: "supplier", value: "Acme, Ltd", confidence: 0.92, rationale: "Named on the cover page" },
    { key: "address", value: '12 High Street, "the old mill"', confidence: 0.71, rationale: "Footer block" },
  ],
  [
    { key: "supplier", value: "Globex", confidence: 0.88, rationale: "Named on the cover page" },
    {
      key: "address",
      value: "40 Long Road\nSecond line",
      confidence: 0.35,
      rationale: "Split across two lines;\nthe second was ambiguous",
    },
  ],
] as const;

// A completed extraction run an operator can open straight from its URL, with
// documents settled and records carrying values — the fixture the run-screen spec
// used to opt out of with four self-probed `test.skip()` guards. Driving the
// editor to produce one meant a sample run that needs staged input documents,
// which is exactly the condition those guards kept skipping on, so the run is
// seeded through the repository instead of the UI.
export const seedExtractionRun = async (
  container: Container,
  ownerUserId: string,
): Promise<{ flowId: string; runId: string }> => {
  const flow = unwrap(
    await container.useCases.createExtractionFlow.execute({
      name: SEED_EXTRACTION_FLOW_NAME,
      ownerUserId,
    }),
    "create extraction flow",
  );

  const version = unwrap(
    await container.useCases.saveExtractionSchema.execute({
      flowId: flow.id,
      schema: {
        fields: [
          {
            label: "Supplier",
            annotation: "Supplier (text)",
            instruction: "Pull the supplier's registered name.",
            doneWhen: null,
          },
          {
            label: "Address",
            annotation: "Address (text)",
            instruction: "Pull the supplier's postal address as written.",
            doneWhen: null,
          },
        ],
        input: { cardinality: "one_per_file", selectionCriteria: null, guidance: "One invoice per supplier." },
        output: {
          format: "docx",
          outputTemplate: null,
          instruction: "Summarise the suppliers found.",
          generateSummary: false,
          summaryTemplate: null,
          contextDocs: [],
        },
      },
    }),
    "save extraction schema",
  );

  const run = unwrap(
    await container.repos.extractionRuns.createRun({
      flowId: flow.id,
      flowVersionId: version.id,
      initiatedByUserId: ownerUserId,
      mode: "full",
      // 0 disables the preview pause, so the seeded run never waits on an
      // operator before reaching a state the export can be driven from.
      previewBoundary: 0,
    }),
    "create extraction run",
  );

  const documents = unwrap(
    await container.repos.extractionRuns.addDocuments(
      run.id,
      SEED_DOCUMENTS.map((document) => ({
        filename: document.filename,
        treePath: document.treePath,
        storageKey: `extraction-runs/${run.id}/inputs/${document.filename}`,
        mimeType: DOCUMENT_MIME,
      })),
    ),
    "add extraction documents",
  );

  // The run's documents are referenced by storage key, and the run screen's
  // source drill-in reads them, so write the objects rather than leaving the
  // fixture pointing at keys that resolve to nothing.
  for (const document of documents) {
    const placeholder = Buffer.from(`e2e seed input for ${document.filename}`, "utf8");
    const stored = await container.objectStorage.put(document.storageKey, placeholder, DOCUMENT_MIME);
    if (stored.error) {
      throw new Error(`seed extraction input ${document.storageKey}: ${stored.error.message}`);
    }
  }

  const records = unwrap(
    await container.repos.extractionRuns.seedRecords(
      run.id,
      documents.map((document, index) => ({
        ordinal: index,
        label: document.filename.replace(/\.docx$/, ""),
        sourceDocumentIds: [document.id],
      })),
    ),
    "seed extraction records",
  );

  for (const [index, record] of records.entries()) {
    unwrap(
      await container.repos.extractionRuns.saveRecordFields(record.id, [...SEED_RECORD_FIELDS[index]!]),
      "save extraction record fields",
    );
  }

  // Settling each document moves the run's own counters, so the screen reports a
  // finished run rather than one whose status and progress bar disagree.
  for (const document of documents) {
    unwrap(
      await container.repos.extractionRuns.settleDocument(document.id, { status: "complete", error: null }, 0),
      "settle extraction document",
    );
  }

  unwrap(
    await container.repos.extractionRuns.updateRunStatus(run.id, "complete"),
    "complete extraction run",
  );

  return { flowId: flow.id, runId: run.id };
};
