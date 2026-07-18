import {
  canPublishWithVisibility,
  domainError,
  err,
  type Flow,
  type FlowUpdate,
  type IFlowRepository,
  type Result,
} from "@rbrasier/domain";

export interface UpdateFlowCaller {
  canPublishToEveryone: boolean;
  // Groups the caller belongs to; lets a non-global publisher share a flow with
  // their own groups (ADR-036 §12). Absent means the caller is in no groups.
  callerGroupIds?: string[];
  // Whether the caller belongs to an organisation; gates publishing with
  // `organisation` visibility (ADR-038). Absent means unaffiliated.
  callerHasOrganisation?: boolean;
}

export class UpdateFlow {
  constructor(private readonly flows: IFlowRepository) {}

  async execute(
    id: string,
    patch: FlowUpdate,
    caller: UpdateFlowCaller = { canPublishToEveryone: false },
  ): Promise<Result<Flow>> {
    if (patch.visibility && !canPublishWithVisibility(patch.visibility, caller)) {
      return err(
        domainError(
          "FORBIDDEN",
          "You do not have permission to publish flows with non-private visibility.",
        ),
      );
    }
    return this.flows.update(id, patch);
  }
}
