import { domainError, err, gatherableTemplateContent, ok } from "@rbrasier/domain";
import type { IReindexSourceRepository, ReindexableDocument, Result } from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_flow_nodes, app_flows, app_session_uploads } from "../db/schema/wayfinder";
import { kb_context_doc_content } from "../db/schema/kb";
import { logRepoError } from "./log-repo-error";

const hasText = (text: string | null): text is string =>
  typeof text === "string" && text.trim().length > 0;

const basename = (path: string): string => path.split("/").pop() ?? path;

// One node's stored config as an indexable document, or null when the node
// carries no template. Template chunks are retrieved into the same system prompt
// that gathers fields, so the body is masked on the way in: an indexed
// `(approval)` tag is a signature slot reaching the conversation by a second
// route (ADR-043 §2). Forward-only — chunks indexed before this keep their tags
// until a reindex runs.
export const templateReindexDocument = (
  flowId: string,
  config: Record<string, unknown>,
): ReindexableDocument | null => {
  const storagePath = config.documentTemplatePath;
  const text = config.documentTemplateContent;
  if (typeof storagePath !== "string") return null;
  if (typeof text !== "string" || !hasText(text)) return null;

  const gatherableText = gatherableTemplateContent(text);
  if (!gatherableText) return null;

  const filenameValue = config.documentTemplateFilename;
  return {
    flowId,
    sessionId: null,
    sourceType: "template",
    storagePath,
    filename: typeof filenameValue === "string" ? filenameValue : basename(storagePath),
    text: gatherableText,
  };
};

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

    return nodeRows
      .map((node) => templateReindexDocument(node.flowId, node.config))
      .filter((document): document is ReindexableDocument => document !== null);
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
