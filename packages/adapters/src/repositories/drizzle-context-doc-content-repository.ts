import { domainError, err, ok } from "@rbrasier/domain";
import type { ExtractionStatus, Result } from "@rbrasier/domain";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { kb_context_doc_content } from "../db/schema/wayfinder";
import { logRepoError } from "./log-repo-error";

export interface UpsertContextDocContentInput {
  flowId: string;
  storagePath: string;
  extractedText: string | null;
  extractionStatus: ExtractionStatus;
}

export class DrizzleContextDocContentRepository {
  constructor(private readonly db: Database) {}

  async upsert(input: UpsertContextDocContentInput): Promise<Result<void>> {
    try {
      await this.db
        .insert(kb_context_doc_content)
        .values({
          flow_id: input.flowId,
          storage_path: input.storagePath,
          extracted_text: input.extractedText,
          extraction_status: input.extractionStatus,
          updated_at: new Date(),
        })
        .onConflictDoUpdate({
          target: kb_context_doc_content.storage_path,
          set: {
            extracted_text: input.extractedText,
            extraction_status: input.extractionStatus,
            updated_at: new Date(),
          },
        });
      return ok(undefined);
    } catch (cause) {
      logRepoError("DrizzleContextDocContentRepository.upsert", cause);
      return err(domainError("INFRA_FAILURE", "Failed to upsert context doc content.", cause));
    }
  }

  async findByFlowId(flowId: string): Promise<Result<typeof kb_context_doc_content.$inferSelect[]>> {
    try {
      const rows = await this.db
        .select()
        .from(kb_context_doc_content)
        .where(eq(kb_context_doc_content.flow_id, flowId));
      return ok(rows);
    } catch (cause) {
      logRepoError("DrizzleContextDocContentRepository.findByFlowId", cause);
      return err(domainError("INFRA_FAILURE", "Failed to find context doc content.", cause));
    }
  }

  async deleteByFlowId(flowId: string): Promise<Result<void>> {
    try {
      await this.db.delete(kb_context_doc_content).where(eq(kb_context_doc_content.flow_id, flowId));
      return ok(undefined);
    } catch (cause) {
      logRepoError("DrizzleContextDocContentRepository.deleteByFlowId", cause);
      return err(domainError("INFRA_FAILURE", "Failed to delete context doc content.", cause));
    }
  }
}
