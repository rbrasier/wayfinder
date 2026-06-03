import { domainError, err, ok } from "@rbrasier/domain";
import type { IReindexSourceRepository, ReindexableDocument, Result } from "@rbrasier/domain";
import type { Database } from "../db/client";
import {
  app_flow_nodes,
  app_flows,
  app_session_uploads,
  kb_context_doc_content,
} from "../db/schema/wayfinder";
import { logRepoError } from "./log-repo-error";

const hasText = (text: string | null): text is string =>
  typeof text === "string" && text.trim().length > 0;

const basename = (path: string): string => path.split("/").pop() ?? path;

// Reads the stored extracted text for every indexed document across the three
// chunk source types. The stored text is the source of truth (ADR-017), so this
// never touches object storage — it just hands the text to the indexer for
// re-chunking and re-embedding under the current provider.
export class DrizzleReindexSourceRepository implements IReindexSourceRepository {
  constructor(private readonly db: Database) {}

  async listReindexableDocuments(): Promise<Result<ReindexableDocument[]>> {
    try {
      const [contextDocs, templates, sessionUploads] = await Promise.all([
        this.listContextDocs(),
        this.listTemplates(),
        this.listSessionUploads(),
      ]);
      return ok([...contextDocs, ...templates, ...sessionUploads]);
    } catch (cause) {
      logRepoError("DrizzleReindexSourceRepository.listReindexableDocuments", cause);
      return err(domainError("INFRA_FAILURE", "Failed to list reindexable documents.", cause));
    }
  }

  private async listContextDocs(): Promise<ReindexableDocument[]> {
    const contentRows = await this.db
      .select({
        flowId: kb_context_doc_content.flow_id,
        storagePath: kb_context_doc_content.storage_path,
        text: kb_context_doc_content.extracted_text,
      })
      .from(kb_context_doc_content);

    // Filenames live on the flow's context_docs manifest, not on the content row.
    const flowRows = await this.db.select({ contextDocs: app_flows.context_docs }).from(app_flows);
    const filenameByPath = new Map<string, string>();
    for (const flow of flowRows) {
      for (const doc of flow.contextDocs) {
        filenameByPath.set(doc.storagePath, doc.filename);
      }
    }

    return contentRows.flatMap((row) =>
      hasText(row.text)
        ? [
            {
              flowId: row.flowId,
              sessionId: null,
              sourceType: "flow_context_doc" as const,
              storagePath: row.storagePath,
              filename: filenameByPath.get(row.storagePath) ?? basename(row.storagePath),
              text: row.text,
            },
          ]
        : [],
    );
  }

  private async listTemplates(): Promise<ReindexableDocument[]> {
    const nodeRows = await this.db
      .select({ flowId: app_flow_nodes.flow_id, config: app_flow_nodes.config })
      .from(app_flow_nodes);

    const documents: ReindexableDocument[] = [];
    for (const node of nodeRows) {
      const storagePath = node.config.documentTemplatePath;
      const text = node.config.documentTemplateContent;
      if (typeof storagePath !== "string") continue;
      if (typeof text !== "string" || !hasText(text)) continue;

      const filenameValue = node.config.documentTemplateFilename;
      documents.push({
        flowId: node.flowId,
        sessionId: null,
        sourceType: "template",
        storagePath,
        filename: typeof filenameValue === "string" ? filenameValue : basename(storagePath),
        text,
      });
    }
    return documents;
  }

  private async listSessionUploads(): Promise<ReindexableDocument[]> {
    const rows = await this.db
      .select({
        sessionId: app_session_uploads.session_id,
        storagePath: app_session_uploads.storage_path,
        filename: app_session_uploads.filename,
        text: app_session_uploads.extracted_text,
      })
      .from(app_session_uploads);

    return rows.flatMap((row) =>
      hasText(row.text)
        ? [
            {
              flowId: null,
              sessionId: row.sessionId,
              sourceType: "session_upload" as const,
              storagePath: row.storagePath,
              filename: row.filename,
              text: row.text,
            },
          ]
        : [],
    );
  }
}
