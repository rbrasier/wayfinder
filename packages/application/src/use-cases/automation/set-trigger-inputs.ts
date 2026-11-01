import {
  domainError,
  err,
  validateTriggerInputs,
  type Flow,
  type IFlowRepository,
  type Result,
  type TriggerInput,
} from "@wayfinder/domain";

// Saves the inputs a flow expects from a watch or webhook (ADR-064 §1). They
// take effect for new runs once the flow is next published, like any edit.
export class SetTriggerInputs {
  constructor(private readonly flows: Pick<IFlowRepository, "update">) {}

  async execute(input: { flowId: string; inputs: TriggerInput[] }): Promise<Result<Flow>> {
    const problems = validateTriggerInputs(input.inputs);
    if (problems.length > 0) return err(domainError("VALIDATION_FAILED", problems.join(" ")));
    return this.flows.update(input.flowId, { triggerInputs: input.inputs });
  }
}
