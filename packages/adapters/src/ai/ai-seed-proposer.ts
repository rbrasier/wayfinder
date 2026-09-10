import {
  describeTemplateFieldFormat,
  ok,
  type FlowTestSeed,
  type ILanguageModel,
  type ISeedProposer,
  type Result,
  type SeedContextItem,
  type SeedProposalNode,
  type SeedProposalRequest,
  type SeedStepOutput,
  type StepOutputField,
  type TemplateField,
} from "@wayfinder/domain";
import { z } from "zod";

const proposalSchema = z.object({
  nodes: z.array(
    z.object({
      nodeId: z.string(),
      gatheredContext: z.array(z.object({ key: z.string(), value: z.string() })),
      fields: z.array(z.object({ key: z.string(), value: z.string() })),
    }),
  ),
});

const SYSTEM_PROMPT = [
  "You invent plausible prior-step data so a workflow author can test a later step",
  "without playing the earlier steps through by hand.",
  "For each step you are given, propose realistic values for its declared fields,",
  "and any free-form facts that step would have gathered in conversation.",
  "Values must satisfy the stated format of each field exactly.",
  "Use only the field keys you are given — never invent a key or a step.",
  "Prefer specific, ordinary-looking values over placeholders like 'string' or 'TBC'.",
].join(" ");

const describeNode = (node: SeedProposalNode): string => {
  const fields = node.fields
    .map((field) => `  - ${field.key}: ${describeTemplateFieldFormat(field)}`)
    .join("\n");
  return [
    `Step "${node.nodeName}" (nodeId: ${node.nodeId})`,
    `  Purpose: ${node.aiInstruction || "not stated"}`,
    fields ? `  Fields:\n${fields}` : "  Fields: none",
  ].join("\n");
};

interface ProposedNode {
  nodeId: string;
  gatheredContext: { key: string; value: string }[];
  fields: { key: string; value: string }[];
}

// The model proposes values; it never gets to decide what a field is. Label and
// type always come from the declared TemplateField, so a proposal can only ever
// be wrong about a value — which the seed validator then catches and reports.
const sanitiseFields = (
  proposed: { key: string; value: string }[],
  declared: Map<string, TemplateField>,
): StepOutputField[] => {
  const fields: StepOutputField[] = [];
  for (const entry of proposed) {
    const field = declared.get(entry.key);
    if (!field) continue;
    fields.push({
      key: field.key,
      label: field.label,
      type: field.type,
      ...(field.options ? { options: field.options } : {}),
      value: entry.value,
    });
  }
  return fields;
};

export class AiSeedProposer implements ISeedProposer {
  constructor(private readonly languageModel: ILanguageModel) {}

  async propose(request: SeedProposalRequest): Promise<Result<FlowTestSeed>> {
    const prompt = [
      `Flow: "${request.flowName}".`,
      "Propose data for these steps, which run before the step under test:",
      request.nodes.map(describeNode).join("\n\n"),
    ].join("\n\n");

    // No temperature is set: this codebase strips the parameter in provider
    // middleware because the Claude 5 family rejects it outright, so asking for
    // temperature 0 here would fail the call rather than make it deterministic
    // (see providers.ts). Determinism is a non-goal for test runs in any case.
    const result = await this.languageModel.generateObject<{ nodes: ProposedNode[] }>({
      purpose: "test-seed",
      system: SYSTEM_PROMPT,
      prompt,
      schema: proposalSchema,
    });
    if (result.error) return result;

    return ok(this.toSeed(request, result.data.object));
  }

  private toSeed(request: SeedProposalRequest, raw: { nodes: ProposedNode[] }): FlowTestSeed {
    const gatheredContext: SeedContextItem[] = [];
    const stepOutputs: SeedStepOutput[] = [];

    if (!Array.isArray(raw?.nodes)) return { gatheredContext, stepOutputs };

    const declaredByNode = new Map(
      request.nodes.map((node) => [
        node.nodeId,
        new Map(node.fields.map((field) => [field.key, field])),
      ]),
    );

    for (const proposed of raw.nodes) {
      const declared = declaredByNode.get(proposed?.nodeId);
      if (!declared) continue;

      for (const item of proposed.gatheredContext ?? []) {
        if (typeof item?.key !== "string" || typeof item?.value !== "string") continue;
        gatheredContext.push({ nodeId: proposed.nodeId, key: item.key, value: item.value });
      }

      const fields = sanitiseFields(proposed.fields ?? [], declared);
      if (fields.length > 0) stepOutputs.push({ nodeId: proposed.nodeId, fields });
    }

    return { gatheredContext, stepOutputs };
  }
}
