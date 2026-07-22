import {
  buildExtractionSnapshot,
  domainError,
  err,
  isExtractionSnapshot,
  ok,
  parseExtractionSchema,
  type ExtractionSchema,
  type ExtractionSchemaDraft,
  type Flow,
  type FlowVersion,
  type IFlowRepository,
  type IFlowVersionRepository,
  type Result,
} from "@rbrasier/domain";

// Creates a new extraction flow (flow_type = 'extraction'). Everything else
// about ownership/visibility is identical to a guided flow (ADR-033 §1).
export class CreateExtractionFlow {
  constructor(private readonly flows: IFlowRepository) {}

  execute(input: { name: string; ownerUserId: string }): Promise<Result<Flow>> {
    return this.flows.create({
      name: input.name,
      ownerUserId: input.ownerUserId,
      flowType: "extraction",
    });
  }
}

// Validates the authored schema and stores it in the flow's open draft version
// snapshot (ADR-033 §3) — no new authoring tables. Publishing later promotes
// this draft unchanged.
export class SaveExtractionSchema {
  constructor(
    private readonly flows: IFlowRepository,
    private readonly flowVersions: IFlowVersionRepository,
  ) {}

  async execute(input: {
    flowId: string;
    schema: ExtractionSchemaDraft;
  }): Promise<Result<FlowVersion>> {
    const flowResult = await this.flows.findById(input.flowId);
    if (flowResult.error) return flowResult;
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));
    if (flowResult.data.flowType !== "extraction") {
      return err(domainError("VALIDATION_FAILED", "This flow is not an extraction flow."));
    }

    const parsed = parseExtractionSchema(input.schema);
    if (parsed.error) return parsed;

    const snapshot = buildExtractionSnapshot(flowResult.data, parsed.data);
    return this.flowVersions.upsertDraft({ flowId: input.flowId, snapshot });
  }
}

// Reads the current extraction schema for the editor: the open draft if one
// exists (the author's in-progress edits), otherwise the latest published
// version. Null when nothing has been authored yet.
export class GetExtractionSchema {
  constructor(private readonly flowVersions: IFlowVersionRepository) {}

  async execute(flowId: string): Promise<Result<ExtractionSchema | null>> {
    const draft = await this.flowVersions.openDraft(flowId);
    if (draft.error) return draft;
    if (draft.data && isExtractionSnapshot(draft.data.snapshot)) {
      return ok(draft.data.snapshot.extraction);
    }

    const published = await this.flowVersions.latestPublished(flowId);
    if (published.error) return published;
    if (published.data && isExtractionSnapshot(published.data.snapshot)) {
      return ok(published.data.snapshot.extraction);
    }

    return ok(null);
  }
}

export class ListExtractionFlows {
  constructor(private readonly flows: IFlowRepository) {}

  execute(): Promise<Result<Flow[]>> {
    return this.flows.listExtraction();
  }
}

export class ListExtractionFlowsForUser {
  constructor(private readonly flows: IFlowRepository) {}

  execute(userId: string): Promise<Result<Flow[]>> {
    return this.flows.listExtractionForUser(userId);
  }
}
