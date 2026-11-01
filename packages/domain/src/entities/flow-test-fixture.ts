import type { StepOutputField } from "./session-step-output";

// Where the prior-step data for a test run came from. Recorded so the modal can
// say what the author is looking at, and so a generated seed is never mistaken
// for values a real operator actually gave (ADR-048).
export type TestSeedSource = "clone" | "fixture" | "generated";

// One gathered-context pair, anchored to the node that supposedly gathered it.
// The anchor matters: the seed materialises one synthetic assistant message per
// node, and `aggregateGatheredContext` only reads messages whose `step_node_id`
// is set, so a context item with no node has nowhere to live.
export interface SeedContextItem {
  nodeId: string;
  key: string;
  value: string;
}

// One prior node's captured field values, in the shape
// `app_session_step_outputs` already stores. Reused rather than translated —
// the seed's whole mechanism is that it writes ordinary rows.
export interface SeedStepOutput {
  nodeId: string;
  fields: StepOutputField[];
}

// Everything a test run needs to look like a session that reached its start
// node: what the prior steps gathered, and what they captured.
export interface FlowTestSeed {
  gatheredContext: SeedContextItem[];
  stepOutputs: SeedStepOutput[];
}

export const emptySeed = (): FlowTestSeed => ({ gatheredContext: [], stepOutputs: [] });

// A seed saved under a name so the same test can be run again after a prompt or
// template change — the regression check the PRD's user story 4 asks for.
// Visible only to `createdByUserId`: a fixture cloned from a live session can
// hold real personal data, and this is the boundary that contains it.
export interface FlowTestFixture extends FlowTestSeed {
  id: string;
  flowId: string;
  name: string;
  startNodeId: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewFlowTestFixture extends FlowTestSeed {
  flowId: string;
  name: string;
  startNodeId: string;
  createdByUserId: string;
}

export interface FlowTestFixtureUpdate {
  name?: string;
  startNodeId?: string;
  gatheredContext?: SeedContextItem[];
  stepOutputs?: SeedStepOutput[];
}
