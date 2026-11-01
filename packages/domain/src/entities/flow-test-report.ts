// What a test run cost and how it behaved, per step. Assembled from rows that
// already exist — `ai_usage_events` for spend and tokens, session messages for
// everything else — so the author-facing flow analytics gap starts closing here
// without a new metrics table (ADR-048 §6).
export interface FlowTestStepReport {
  nodeId: string;
  nodeName: string;
  // Assistant turns spent on this step before it advanced. The number an author
  // tuning a prompt is actually trying to bring down.
  turns: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  // Milliseconds from the user message that provoked each turn to the assistant
  // message that answered it, summed across the step's turns. `ai_usage_events`
  // records no duration, so this is derived from message timestamps and measures
  // the whole server-side turn: model call, tool loop and document generation.
  latencyMs: number;
  // Every `stepCompleteConfidence` recorded on this step, in order, so the
  // author can see a step converging — or oscillating.
  confidenceTrajectory: number[];
  // Whether the run got past this step. Derived from the transcript — a later
  // step having turns means this one advanced — because the readiness gate's
  // own verdict is computed per turn and never persisted.
  //
  // The gate's `missingInformation` is deliberately absent for the same reason:
  // EvaluateStepReadiness returns it to the turn that asked, and nothing writes
  // it down, so it cannot be recovered after the run. Reporting it would mean
  // persisting gate outcomes, which is a change to the runner this feature is
  // built specifically not to make.
  advanced: boolean;
  // Set when this step generated a document, so the modal can offer it for
  // download rather than only reporting that generation happened.
  documentFilename: string | null;
}

export interface FlowTestRunReport {
  sessionId: string;
  flowId: string;
  startNodeId: string | null;
  status: string;
  startedAt: Date;
  steps: FlowTestStepReport[];
  totalCostUsd: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  // True when an approval on this run was resolved to the testing author rather
  // than a real supervisor. Surfaced so the modal states the substitution
  // instead of letting the author assume production routing was exercised.
  approverSubstituted: boolean;
}
