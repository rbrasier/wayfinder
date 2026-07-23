import {
  domainError,
  err,
  isExtractionSnapshot,
  ok,
  type ExtractionSchema,
  type IFlowVersionRepository,
  type Result,
} from "@rbrasier/domain";

// Loads the exact extraction schema a run was executed against, from the version
// snapshot the run pinned (ADR-033 §3). Shared by the export, document-generation,
// and report use-cases so all three read the same authored field order + labels.
export const loadExtractionSchemaForVersion = async (
  flowVersions: IFlowVersionRepository,
  flowVersionId: string,
): Promise<Result<ExtractionSchema>> => {
  const version = await flowVersions.getById(flowVersionId);
  if (version.error) return version;
  if (!version.data || !isExtractionSnapshot(version.data.snapshot)) {
    return err(domainError("NOT_FOUND", "This run's extraction schema could not be loaded."));
  }
  return ok(version.data.snapshot.extraction);
};
