import {
  domainError,
  err,
  ok,
  type FlowVersion,
  type IAuditLogger,
  type IFlowVersionRepository,
  type Result,
} from "@rbrasier/domain";

export interface RestoreFlowVersionInput {
  versionId: string;
  restoredByUserId: string;
  changeSummary?: string | null;
}

// Non-destructive, forward-only restore: rewrites the live flow/nodes/edges to
// match a past snapshot (preserving node ids) and records a *new* published
// version noting the source. No prior snapshot is mutated or deleted (ADR-015).
export class RestoreFlowVersion {
  constructor(
    private readonly flowVersions: IFlowVersionRepository,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(input: RestoreFlowVersionInput): Promise<Result<FlowVersion>> {
    const sourceResult = await this.flowVersions.getById(input.versionId);
    if (sourceResult.error) return sourceResult;
    if (!sourceResult.data) return err(domainError("NOT_FOUND", "Flow version not found."));

    const source = sourceResult.data;
    if (source.versionNumber === null) {
      return err(domainError("VALIDATION_FAILED", "Cannot restore an unpublished draft version."));
    }

    const restored = await this.flowVersions.restore({
      flowId: source.flowId,
      snapshot: source.snapshot,
      sourceVersionNumber: source.versionNumber,
      publishedByUserId: input.restoredByUserId,
      changeSummary: input.changeSummary ?? null,
    });
    if (restored.error) return restored;

    await this.auditLogger.log({
      actorId: input.restoredByUserId,
      action: "flow.version.restored",
      resourceType: "flow",
      resourceId: source.flowId,
      metadata: {
        sourceVersionId: source.id,
        sourceVersionNumber: source.versionNumber,
        newVersionId: restored.data.id,
        newVersionNumber: restored.data.versionNumber,
      },
    });

    return ok(restored.data);
  }
}
