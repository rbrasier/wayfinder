import type { ReindexableDocument } from "../entities/reindexable-document";
import type { Result } from "../result";

// Reads every already-extracted document across all chunk source types (flow
// context docs, templates, session uploads) so they can be re-embedded with the
// currently selected embedding provider. Documents with no stored text are skipped.
export interface IReindexSourceRepository {
  listReindexableDocuments(): Promise<Result<ReindexableDocument[]>>;
}
