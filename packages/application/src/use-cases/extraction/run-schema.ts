import {
  domainError,
  err,
  isExtractionSnapshot,
  ok,
  type ExtractionSchema,
  type IFlowVersionRepository,
  type Result,
} from "@wayfinder/domain";

// Loads the exact extraction schema a run was executed against, from the version
// snapshot the run pinned (ADR-033 §3). Shared by the export, document-generation,
// and report use-cases so all three read the same authored field order + labels.
// A null version id reaches here only from an analyse run, which drafts the
// schema rather than running against one (ADR-060 §2). Export, document
// generation and the field report all read results an analysis never produces,
// so this is a caller mistake worth naming rather than an empty schema to
// stumble over downstream.
export const loadExtractionSchemaForVersion = async (
  flowVersions: IFlowVersionRepository,
  flowVersionId: string | null,
): Promise<Result<ExtractionSchema>> => {
  if (flowVersionId === null) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "This run drafted a field set rather than extracting records, so it has no schema, results or documents to read.",
      ),
    );
  }

  const version = await flowVersions.getById(flowVersionId);
  if (version.error) return version;
  if (!version.data || !isExtractionSnapshot(version.data.snapshot)) {
    return err(domainError("NOT_FOUND", "This run's extraction schema could not be loaded."));
  }
  return ok(version.data.snapshot.extraction);
};
