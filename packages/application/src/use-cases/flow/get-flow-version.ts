import {
  domainError,
  err,
  ok,
  type FlowVersion,
  type IFlowVersionRepository,
  type Result,
} from "@rbrasier/domain";

// One full snapshot for read-only inspection of a past version.
export class GetFlowVersion {
  constructor(private readonly flowVersions: IFlowVersionRepository) {}

  async execute(versionId: string): Promise<Result<FlowVersion>> {
    const result = await this.flowVersions.getById(versionId);
    if (result.error) return result;
    if (!result.data) return err(domainError("NOT_FOUND", "Flow version not found."));
    return ok(result.data);
  }
}
