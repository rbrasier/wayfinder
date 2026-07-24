import type {
  ExtractionDraftDocument,
  NewExtractionDraftDocument,
} from "../entities/extraction-draft-document";
import type { Result } from "../result";

// Persists the input documents staged against an extraction flow's draft
// (progressive upload — ADR-033). Storage of the bytes themselves is the object
// store's job; this tracks the rows so the intake survives a page reload and can
// seed a run.
export interface IExtractionDraftDocumentRepository {
  add(
    flowId: string,
    documents: NewExtractionDraftDocument[],
  ): Promise<Result<ExtractionDraftDocument[]>>;
  listForFlow(flowId: string): Promise<Result<ExtractionDraftDocument[]>>;
  getById(id: string): Promise<Result<ExtractionDraftDocument | null>>;
  remove(id: string): Promise<Result<void>>;
}
