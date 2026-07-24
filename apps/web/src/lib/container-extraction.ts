import {
  AdvanceBatchRuns,
  CancelRun,
  ContinueRun,
  CreateExtractionFlow,
  EditRecordField,
  ExportRunResults,
  GenerateRunDocuments,
  GetExtractionRunReport,
  GetExtractionSchema,
  ListDraftDocuments,
  ListExtractionFlows,
  ListExtractionFlowsForUser,
  MarkRunComplete,
  ProcessExtractionTask,
  RemoveDraftDocument,
  RetryFailed,
  RunSampleExtraction,
  SaveExtractionSchema,
  StartBatchRun,
  UploadDraftDocuments,
} from "@rbrasier/application";
import {
  DrizzleExtractionDraftRepository,
  DrizzleExtractionRunRepository,
  XlsxWriter,
  ZipIngestor,
  createDatabase,
} from "@rbrasier/adapters";
import type {
  IAuditLogger,
  IDocumentExtractor,
  IDocumentGenerator,
  IFlowRepository,
  IFlowVersionRepository,
  ILanguageModel,
  IObjectStorage,
} from "@rbrasier/domain";

type Database = ReturnType<typeof createDatabase>;

interface ExtractionDependencies {
  db: Database;
  flows: IFlowRepository;
  flowVersions: IFlowVersionRepository;
  languageModel: ILanguageModel;
  documentExtractor: IDocumentExtractor;
  documentGenerator: IDocumentGenerator;
  objectStorage: IObjectStorage;
  auditLogger: IAuditLogger;
}

// The extraction-flow ("Synthesise Information") module (ADR-033), factored out
// of container.ts to keep that file under the source-size ratchet. Returns both
// the run repository (surfaced in `repos` for the run router) and the use-cases.
export const buildExtractionModule = ({
  db,
  flows,
  flowVersions,
  languageModel,
  documentExtractor,
  documentGenerator,
  objectStorage,
  auditLogger,
}: ExtractionDependencies) => {
  const extractionRuns = new DrizzleExtractionRunRepository(db);
  const extractionDrafts = new DrizzleExtractionDraftRepository(db);
  const archiveExtractor = new ZipIngestor();
  const spreadsheetWriter = new XlsxWriter();
  const processExtractionTask = new ProcessExtractionTask(
    extractionRuns,
    objectStorage,
    documentExtractor,
    languageModel,
  );

  return {
    repository: extractionRuns,
    draftRepository: extractionDrafts,
    useCases: {
      createExtractionFlow: new CreateExtractionFlow(flows),
      uploadDraftDocuments: new UploadDraftDocuments(extractionDrafts, objectStorage),
      listDraftDocuments: new ListDraftDocuments(extractionDrafts),
      removeDraftDocument: new RemoveDraftDocument(extractionDrafts, objectStorage),
      saveExtractionSchema: new SaveExtractionSchema(flows, flowVersions),
      getExtractionSchema: new GetExtractionSchema(flowVersions),
      listExtractionFlows: new ListExtractionFlows(flows),
      listExtractionFlowsForUser: new ListExtractionFlowsForUser(flows),
      runSampleExtraction: new RunSampleExtraction(languageModel, documentExtractor),
      startBatchRun: new StartBatchRun(
        flowVersions,
        extractionRuns,
        objectStorage,
        archiveExtractor,
        languageModel,
        documentExtractor,
      ),
      processExtractionTask,
      advanceBatchRuns: new AdvanceBatchRuns(extractionRuns, flowVersions, processExtractionTask),
      cancelRun: new CancelRun(extractionRuns),
      retryFailed: new RetryFailed(extractionRuns),
      continueRun: new ContinueRun(extractionRuns),
      exportRunResults: new ExportRunResults(
        extractionRuns,
        flowVersions,
        spreadsheetWriter,
        objectStorage,
        auditLogger,
      ),
      generateRunDocuments: new GenerateRunDocuments(
        extractionRuns,
        flowVersions,
        documentGenerator,
        objectStorage,
        languageModel,
        auditLogger,
      ),
      editRecordField: new EditRecordField(extractionRuns, auditLogger),
      markRunComplete: new MarkRunComplete(extractionRuns, auditLogger),
      getExtractionRunReport: new GetExtractionRunReport(extractionRuns, flowVersions),
    },
  };
};
