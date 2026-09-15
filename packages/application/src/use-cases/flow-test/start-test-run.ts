import {
  emptySeed,
  ok,
  validateSeedAgainstNodes,
  type FlowTestSeed,
  type IFlowNodeRepository,
  type ISessionMessageRepository,
  type ISessionStepOutputRepository,
  type Result,
  type SeedContextItem,
  type SeedReject,
  type Session,
} from "@wayfinder/domain";
import type { StartSession } from "../session/start-session";

export interface StartTestRunInput {
  flowId: string;
  userId: string;
  isAdmin?: boolean;
  // The node under test. Omitted starts at the root, which is a whole-flow run.
  startNodeId?: string;
  // Omitted means an empty seed — again, a whole-flow run.
  seed?: FlowTestSeed;
}

export interface TestRunStarted {
  session: Session;
  // Seeded values that were not written, each with a reason. Surfaced rather
  // than swallowed: a silently substituted value makes a broken step look sound.
  rejects: SeedReject[];
}

// The content stored on a synthetic assistant message. It is never shown as a
// turn in its own right — the modal renders the seed in the setup pane — but a
// message with empty content would read as a failed turn to anything that
// inspects the transcript.
const seededContent = (nodeName: string): string =>
  `[Seeded for this test run] Context captured by the "${nodeName}" step.`;

export class StartTestRun {
  constructor(
    private readonly startSession: StartSession,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly sessionMessages: ISessionMessageRepository,
    private readonly sessionStepOutputs: ISessionStepOutputRepository,
  ) {}

  async execute(input: StartTestRunInput): Promise<Result<TestRunStarted>> {
    const nodesResult = await this.flowNodes.listByFlow(input.flowId);
    if (nodesResult.error) return nodesResult;

    const { accepted, rejects } = validateSeedAgainstNodes(
      input.seed ?? emptySeed(),
      nodesResult.data,
    );

    // Authorisation and flow state are settled by StartSession before any seed
    // row is written, so a refused run leaves nothing behind.
    const sessionResult = await this.startSession.execute({
      flowId: input.flowId,
      userId: input.userId,
      mode: "test",
      startNodeId: input.startNodeId,
      isAdmin: input.isAdmin,
    });
    if (sessionResult.error) return sessionResult;
    const session = sessionResult.data;

    const nodeNames = new Map(nodesResult.data.map((node) => [node.id, node.name]));

    const contextWritten = await this.writeGatheredContext(
      session.id,
      accepted.gatheredContext,
      nodeNames,
    );
    if (contextWritten.error) return contextWritten;

    const outputsWritten = await this.writeStepOutputs(session, accepted);
    if (outputsWritten.error) return outputsWritten;

    return ok({ session, rejects });
  }

  // One assistant message per seeded node, carrying that node's items as
  // `aiPayload.contextGathered`. This is the whole mechanism: those are the
  // exact conditions `aggregateGatheredContext` selects on, so the seed reads
  // back through the production query with no change to it.
  private async writeGatheredContext(
    sessionId: string,
    items: SeedContextItem[],
    nodeNames: Map<string, string>,
  ): Promise<Result<void>> {
    const byNode = new Map<string, SeedContextItem[]>();
    for (const item of items) {
      const existing = byNode.get(item.nodeId);
      if (existing) {
        existing.push(item);
        continue;
      }
      byNode.set(item.nodeId, [item]);
    }

    for (const [nodeId, nodeItems] of byNode) {
      const created = await this.sessionMessages.create({
        sessionId,
        role: "assistant",
        content: seededContent(nodeNames.get(nodeId) ?? "an earlier step"),
        stepNodeId: nodeId,
        confidence: 1,
        aiPayload: {
          response: seededContent(nodeNames.get(nodeId) ?? "an earlier step"),
          rationale: "Seeded before the first turn of a test run.",
          stepCompleteConfidence: 1,
          contextGathered: nodeItems.map((item) => ({ key: item.key, value: item.value })),
        },
      });
      if (created.error) return created;
    }

    return ok(undefined);
  }

  private async writeStepOutputs(
    session: Session,
    seed: FlowTestSeed,
  ): Promise<Result<void>> {
    for (const stepOutput of seed.stepOutputs) {
      const created = await this.sessionStepOutputs.create({
        sessionId: session.id,
        flowId: session.flowId,
        nodeId: stepOutput.nodeId,
        fields: stepOutput.fields,
      });
      if (created.error) return created;
    }
    return ok(undefined);
  }
}
