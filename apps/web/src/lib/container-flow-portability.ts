import {
  DuplicateFlow,
  ExportFlow,
  ImportFlow,
  InspectFlowImport,
} from "@wayfinder/application";
import { sha256Bytes, ZipFlowArchive } from "@wayfinder/adapters";
import type {
  IAuditLogger,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  IFlowRepository,
  IMcpServerRepository,
  IObjectStorage,
  ISkillRepository,
} from "@wayfinder/domain";

interface FlowPortabilityDeps {
  flows: IFlowRepository;
  flowNodes: IFlowNodeRepository;
  flowEdges: IFlowEdgeRepository;
  objectStorage: IObjectStorage;
  auditLogger: IAuditLogger;
  // Taken whole so the root container does not have to reach into it twice.
  skillsAndMcp: { repos: { skills: ISkillRepository; mcpServers: IMcpServerRepository } };
  // The version stamped into every manifest's `exportedFrom`. Read here rather
  // than in the root container, which has no other reason to know it.
  appVersion?: string;
}

// Export / import / duplicate, wired as one unit (ADR-049). Kept out of
// container.ts for the same reason as the skills, extraction and approval
// modules: the root container is already at the size limit validate.sh enforces.
export const buildFlowPortability = ({
  flows,
  flowNodes,
  flowEdges,
  objectStorage,
  auditLogger,
  skillsAndMcp,
  appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown",
}: FlowPortabilityDeps) => {
  const flowArchive = new ZipFlowArchive();
  const { skills, mcpServers } = skillsAndMcp.repos;

  return {
    exportFlow: new ExportFlow(
      flows,
      flowNodes,
      flowEdges,
      skills,
      mcpServers,
      objectStorage,
      flowArchive,
      auditLogger,
      appVersion,
      sha256Bytes,
    ),
    inspectFlowImport: new InspectFlowImport(flowArchive, skills, mcpServers),
    importFlow: new ImportFlow(
      flowArchive,
      skills,
      mcpServers,
      objectStorage,
      flows,
      flowNodes,
      flowEdges,
      auditLogger,
    ),
    duplicateFlow: new DuplicateFlow(flows, flowNodes, flowEdges, objectStorage),
  };
};
