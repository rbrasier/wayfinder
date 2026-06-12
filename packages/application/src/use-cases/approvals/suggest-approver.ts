import {
  domainError,
  err,
  ok,
  type Approval,
  type ApprovalNodeConfig,
  type IApprovalRepository,
  type IDocumentChunkRepository,
  type IEmbeddingsProvider,
  type IFlowNodeRepository,
  type ILanguageModel,
  type IReportingLineResolver,
  type IUserRepository,
  type PositionLookupInput,
  type Result,
} from "@rbrasier/domain";
import { delegationPositionSchema, type DelegationPosition } from "@rbrasier/shared";

export interface SuggestApproverInput {
  sessionId: string;
  flowId: string;
  nodeId: string;
  requestedByUserId: string;
}

export interface SuggestedApprover {
  userId: string;
  name: string | null;
  email: string;
}

export interface SuggestApproverOutput {
  approval: Approval;
  suggestedApprover: SuggestedApprover | null;
}

// Reaching an approval node: compute a *suggested* approver from the node's
// `approverSource` and write (or return) the single pending row that gates it.
// Idempotent — reaching the node twice must not raise two requests.
export class SuggestApprover {
  constructor(
    private readonly approvals: IApprovalRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly resolver: IReportingLineResolver,
    private readonly users: IUserRepository,
    // RAG dependencies for the `dynamic` path. All optional so the use-case stays
    // testable and degrades to a plain roleHint lookup when unwired.
    private readonly embeddings?: IEmbeddingsProvider,
    private readonly documentChunks?: IDocumentChunkRepository,
    private readonly languageModel?: ILanguageModel,
  ) {}

  async execute(input: SuggestApproverInput): Promise<Result<SuggestApproverOutput>> {
    const existing = await this.approvals.findPendingByNode(input.sessionId, input.nodeId);
    if (existing.error) return existing;
    if (existing.data) {
      const suggestedApprover = await this.describe(existing.data.suggestedApproverUserId);
      return ok({ approval: existing.data, suggestedApprover });
    }

    const nodeResult = await this.flowNodes.findById(input.nodeId);
    if (nodeResult.error) return nodeResult;
    const node = nodeResult.data;
    if (!node || node.type !== "approval") {
      return err(domainError("VALIDATION_FAILED", "Node is not an approval node."));
    }
    const config = node.config as unknown as ApprovalNodeConfig;

    const suggestedUserId = await this.resolveSuggestion(config, input);

    const created = await this.approvals.create({
      sessionId: input.sessionId,
      flowId: input.flowId,
      nodeId: input.nodeId,
      requestedByUserId: input.requestedByUserId,
      approverSource: config.approverSource,
      suggestedApproverUserId: suggestedUserId,
      status: "pending",
    });
    if (created.error) return created;

    const suggestedApprover = await this.describe(suggestedUserId);
    return ok({ approval: created.data, suggestedApprover });
  }

  private async resolveSuggestion(
    config: ApprovalNodeConfig,
    input: SuggestApproverInput,
  ): Promise<string | null> {
    if (config.approverSource === "dynamic") {
      const lookup = await this.resolveDynamicLookup(config, input);
      const holders = await this.resolver.findPositionHolder(lookup);
      if (holders.error) return null;
      const withAccount = holders.data.filter((person) => person.userId);
      // Only an unambiguous single holder is auto-suggested; zero or several
      // leave the operator to pick via "Someone else".
      return withAccount.length === 1 ? withAccount[0]!.userId : null;
    }

    const level: 1 | 2 = config.approverSource === "second_level_supervisor" ? 2 : 1;
    const suggestion = await this.resolver.suggest({ level, userId: input.requestedByUserId });
    if (suggestion.error) return null;
    if ("unresolved" in suggestion.data) return null;
    return suggestion.data.suggestedApproverUserId;
  }

  // RAG step for `dynamic`: retrieve the delegation policy that governs this node,
  // extract the named position from it, and look that up. Falls back to the plain
  // roleHint at every break in the chain so a missing doc or model never blocks
  // the suggestion.
  private async resolveDynamicLookup(
    config: ApprovalNodeConfig,
    input: SuggestApproverInput,
  ): Promise<PositionLookupInput> {
    const fallback: PositionLookupInput = { role: config.roleHint };
    if (!this.embeddings || !this.documentChunks || !this.languageModel) return fallback;

    const query = [config.roleHint, config.instructions].filter(Boolean).join(" ").trim();
    if (!query) return fallback;

    const embedded = await this.embeddings.embed(query);
    if (embedded.error) return fallback;

    const chunks = await this.documentChunks.search({
      flowId: input.flowId,
      sessionId: input.sessionId,
      embedding: embedded.data,
      limit: 5,
      minSimilarity: 0.75,
    });
    if (chunks.error || chunks.data.length === 0) return fallback;

    const extracted = await this.extractPosition(chunks.data.map((chunk) => chunk.chunkText), config.roleHint);
    if (!extracted) return fallback;

    return {
      role: extracted.role ?? config.roleHint,
      band: extracted.band,
      businessUnit: extracted.businessUnit,
    };
  }

  private async extractPosition(
    chunkTexts: string[],
    roleHint: string | undefined,
  ): Promise<DelegationPosition | null> {
    const result = await this.languageModel!.generateObject<DelegationPosition>({
      purpose: "branching",
      system:
        "You read an organisation's delegation policy and identify the single position that holds the approval authority described. Return only fields the policy states; leave a field empty if it is not named.",
      prompt: [
        roleHint ? `The flow names this approver role: ${roleHint}.` : "",
        "Policy text:",
        chunkTexts.join("\n\n"),
      ]
        .filter(Boolean)
        .join("\n"),
      schema: delegationPositionSchema,
      temperature: 0,
    });
    if (result.error) return null;

    const position = result.data.object;
    if (!position.role && !position.band && !position.businessUnit) return null;
    return position;
  }

  private async describe(userId: string | null): Promise<SuggestedApprover | null> {
    if (!userId) return null;
    const userResult = await this.users.findById(userId);
    if (userResult.error || !userResult.data) return null;
    return { userId: userResult.data.id, name: userResult.data.name, email: userResult.data.email };
  }
}
