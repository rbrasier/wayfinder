import { domainError, err, ok } from "@rbrasier/domain";
import type {
  ISessionUploadRepository,
  NewSessionUpload,
  Result,
  SessionUpload,
} from "@rbrasier/domain";
import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { app_session_uploads } from "../db/schema/wayfinder";
import { logRepoError } from "./log-repo-error";

const toEntity = (row: typeof app_session_uploads.$inferSelect): SessionUpload => ({
  id: row.id,
  sessionId: row.session_id,
  messageId: row.message_id,
  filename: row.filename,
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes,
  storagePath: row.storage_path,
  extractedText: row.extracted_text,
  extractionStatus: row.extraction_status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleSessionUploadRepository implements ISessionUploadRepository {
  constructor(private readonly db: Database) {}

  async create(upload: NewSessionUpload): Promise<Result<SessionUpload>> {
    try {
      const [row] = await this.db
        .insert(app_session_uploads)
        .values({
          session_id: upload.sessionId,
          message_id: upload.messageId ?? null,
          filename: upload.filename,
          mime_type: upload.mimeType,
          size_bytes: upload.sizeBytes,
          storage_path: upload.storagePath,
          extracted_text: upload.extractedText,
          extraction_status: upload.extractionStatus,
        })
        .returning();
      if (!row) {
        return err(domainError("INFRA_FAILURE", "Session upload insert returned no row."));
      }
      return ok(toEntity(row));
    } catch (cause) {
      logRepoError("DrizzleSessionUploadRepository.create", cause);
      return err(domainError("INFRA_FAILURE", "Failed to create session upload.", cause));
    }
  }

  async listBySession(sessionId: string): Promise<Result<SessionUpload[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_session_uploads)
        .where(eq(app_session_uploads.session_id, sessionId))
        .orderBy(asc(app_session_uploads.created_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      logRepoError("DrizzleSessionUploadRepository.listBySession", cause);
      return err(domainError("INFRA_FAILURE", "Failed to list session uploads.", cause));
    }
  }

  async delete(id: string): Promise<Result<void>> {
    try {
      await this.db.delete(app_session_uploads).where(eq(app_session_uploads.id, id));
      return ok(undefined);
    } catch (cause) {
      logRepoError("DrizzleSessionUploadRepository.delete", cause);
      return err(domainError("INFRA_FAILURE", "Failed to delete session upload.", cause));
    }
  }
}
