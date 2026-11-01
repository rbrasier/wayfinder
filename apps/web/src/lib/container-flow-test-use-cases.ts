import {
  BuildSeedFromSession,
  DeleteTestSession,
  GenerateSeed,
  GetTestRunReport,
  StartSession,
  StartTestRun,
} from "@wayfinder/application";
import type {
  IFlowEdgeRepository,
  IFlowNodeRepository,
  IFlowRepository,
  IFlowVersionRepository,
  ISeedProposer,
  ISessionMessageRepository,
  ISessionRepository,
  ISessionStepOutputRepository,
  IUsageRepository,
} from "@wayfinder/domain";

export interface FlowTestUseCaseDeps {
  sessions: ISessionRepository;
  sessionMessages: ISessionMessageRepository;
  sessionStepOutputs: ISessionStepOutputRepository;
  flows: IFlowRepository;
  flowNodes: IFlowNodeRepository;
  flowEdges: IFlowEdgeRepository;
  flowVersions: IFlowVersionRepository;
  usage: IUsageRepository;
  seedProposer: ISeedProposer;
}

// Split out of container.ts for the same reason the approval use-cases were:
// the root container is at the file-size ceiling, and a feature's wiring is a
// coherent unit on its own. The sweep is not here — it runs on the API server's
// retention worker, not in the web container.
export const buildFlowTestUseCases = (deps: FlowTestUseCaseDeps) => ({
  startTestRun: new StartTestRun(
    new StartSession(deps.sessions, deps.flows, deps.flowNodes, deps.flowEdges, deps.flowVersions),
    deps.flowNodes,
    deps.sessionMessages,
    deps.sessionStepOutputs,
  ),
  buildSeedFromSession: new BuildSeedFromSession(
    deps.sessions,
    deps.flows,
    deps.sessionMessages,
    deps.sessionStepOutputs,
  ),
  generateSeed: new GenerateSeed(deps.flows, deps.flowNodes, deps.flowEdges, deps.seedProposer),
  getTestRunReport: new GetTestRunReport(
    deps.sessions,
    deps.flows,
    deps.flowNodes,
    deps.sessionMessages,
    deps.usage,
  ),
  deleteTestSession: new DeleteTestSession(deps.sessions, deps.flows),
});
