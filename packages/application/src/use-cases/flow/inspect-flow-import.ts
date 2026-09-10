import { err, FLOW_ARCHIVE_LIMITS, ok, resolveFlowDependencies } from "@wayfinder/domain";
import type {
  DependencyCandidates,
  FlowArchiveLimits,
  FlowImportInspection,
  IFlowArchiveReader,
  IMcpServerRepository,
  ISkillRepository,
  Result,
} from "@wayfinder/domain";

export interface InspectFlowImportInput {
  archive: Buffer;
}

// Loads the candidates an import can resolve against: what is selectable in a
// flow today, so an archived skill or a disabled server never silently
// satisfies a dependency.
export const loadDependencyCandidates = async (
  skills: ISkillRepository,
  mcpServers: IMcpServerRepository,
): Promise<Result<DependencyCandidates>> => {
  const skillList = await skills.list();
  if (skillList.error) return err(skillList.error);

  const serverList = await mcpServers.list();
  if (serverList.error) return err(serverList.error);

  return ok({
    skills: skillList.data
      .filter((skill) => skill.status === "active")
      .map((skill) => ({ id: skill.id, name: skill.name })),
    servers: serverList.data
      .filter((server) => server.status === "active")
      .map((server) => ({
        id: server.id,
        label: server.label,
        communicatesExternally: server.communicatesExternally,
      })),
  });
};

// Opens an archive and reports what it holds and what will not resolve —
// **without writing anything**. This use-case is deliberately not given a flow,
// node, edge or object-storage repository, so "writes nothing" is structural
// rather than a promise (ADR-049 §5).
export class InspectFlowImport {
  constructor(
    private readonly archiveReader: IFlowArchiveReader,
    private readonly skills: ISkillRepository,
    private readonly mcpServers: IMcpServerRepository,
    private readonly limits: FlowArchiveLimits = FLOW_ARCHIVE_LIMITS,
  ) {}

  async execute(input: InspectFlowImportInput): Promise<Result<FlowImportInspection>> {
    const contents = await this.archiveReader.read(input.archive, this.limits);
    if (contents.error) return err(contents.error);

    const candidates = await loadDependencyCandidates(this.skills, this.mcpServers);
    if (candidates.error) return err(candidates.error);

    const outcome = resolveFlowDependencies(contents.data.manifest.dependencies, candidates.data);

    return ok({
      manifest: contents.data.manifest,
      resolved: outcome.resolved,
      unresolved: outcome.unresolved,
      assetCount: contents.data.manifest.assets.length,
      warnings: outcome.warnings,
    });
  }
}
