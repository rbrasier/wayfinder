import {
  domainError,
  err,
  ok,
  type ExtractionDraftDocument,
  type IExtractionDraftDocumentRepository,
  type NewExtractionDraftDocument,
  type Result,
} from "@rbrasier/domain";
import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { app_extraction_draft_documents } from "../db/schema/wayfinder";

type DraftRow = typeof app_extraction_draft_documents.$inferSelect;

const toDraftDocument = (row: DraftRow): ExtractionDraftDocument => ({
  id: row.id,
  flowId: row.flow_id,
  filename: row.filename,
  treePath: row.tree_path,
  storageKey: row.storage_key,
  mimeType: row.mime_type,
});

export class DrizzleExtractionDraftRepository implements IExtractionDraftDocumentRepository {
  constructor(private readonly db: Database) {}

  async add(
    flowId: string,
    documents: NewExtractionDraftDocument[],
  ): Promise<Result<ExtractionDraftDocument[]>> {
    if (documents.length === 0) return ok([]);
    try {
      const rows = await this.db
        .insert(app_extraction_draft_documents)
        .values(
          documents.map((document) => ({
            flow_id: flowId,
            filename: document.filename,
            tree_path: document.treePath,
            storage_key: document.storageKey,
            mime_type: document.mimeType,
          })),
        )
        .returning();
      return ok(rows.map(toDraftDocument));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Could not save the draft documents.", cause));
    }
  }

  async listForFlow(flowId: string): Promise<Result<ExtractionDraftDocument[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_extraction_draft_documents)
        .where(eq(app_extraction_draft_documents.flow_id, flowId))
        .orderBy(asc(app_extraction_draft_documents.created_at));
      return ok(rows.map(toDraftDocument));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Could not list the draft documents.", cause));
    }
  }

  async getById(id: string): Promise<Result<ExtractionDraftDocument | null>> {
    try {
      const rows = await this.db
        .select()
        .from(app_extraction_draft_documents)
        .where(eq(app_extraction_draft_documents.id, id))
        .limit(1);
      return ok(rows[0] ? toDraftDocument(rows[0]) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Could not read the draft document.", cause));
    }
  }

  async remove(id: string): Promise<Result<void>> {
    try {
      await this.db
        .delete(app_extraction_draft_documents)
        .where(eq(app_extraction_draft_documents.id, id));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Could not remove the draft document.", cause));
    }
  }
}
