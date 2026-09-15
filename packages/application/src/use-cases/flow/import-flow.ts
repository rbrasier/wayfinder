import {
  domainError,
  err,
  FLOW_ARCHIVE_LIMITS,
  ok,
  remapNodeReferences,
  resolveFlowDependencies,
  rewriteSnapshot,
} from "@wayfinder/domain";
import type {
  Flow,
  FlowArchiveLimits,
  FlowExportAsset,
  FlowExportDependency,
  FlowSnapshot,
  IAuditLogger,
  IFlowArchiveReader,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  IFlowRepository,
  IMcpServerRepository,
  IObjectStorage,
  ISkillRepository,
  Result,
} from "@wayfinder/domain";
import { loadDependencyCandidates } from "./inspect-flow-import";

export interface ImportFlowInput {
  archive: Buffer;
  importedByUserId: string;
}

export interface ImportFlowOutput {
  flow: Flow;
  unresolved: FlowExportDependency[];
  warnings: string[];
}

export type GenerateStorageKey = () => string;

const defaultGenerateKey: GenerateStorageKey = () => `flows/imported/${crypto.randomUUID()}`;

// Commits an archive as a brand-new draft flow owned by the importer.
//
// Nothing from the archive is ever used as a write path: every asset is stored
// under a key this deployment generates, which is what makes zip-slip
// structurally impossible rather than merely defended against (ADR-049 §7).
export class ImportFlow {
  constructor(
    private readonly archiveReader: IFlowArchiveReader,
    private readonly skills: ISkillRepository,
    private readonly mcpServers: IMcpServerRepository,
    private readonly objectStorage: IObjectStorage,
    private readonly flows: IFlowRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly generateKey: GenerateStorageKey = defaultGenerateKey,
    private readonly limits: FlowArchiveLimits = FLOW_ARCHIVE_LIMITS,
  ) {}

  async execute(input: ImportFlowInput): Promise<Result<ImportFlowOutput>> {
    const contents = await this.archiveReader.read(input.archive, this.limits);
    if (contents.error) return err(contents.error);

    const { manifest, assets } = contents.data;

    const candidates = await loadDependencyCandidates(this.skills, this.mcpServers);
    if (candidates.error) return err(candidates.error);

    const outcome = resolveFlowDependencies(manifest.dependencies, candidates.data);

    const assetKeys = await this.storeAssets(manifest.assets, assets);
    if (assetKeys.error) return err(assetKeys.error);

    const rewritten = rewriteSnapshot(manifest.snapshot, {
      resolved: outcome.resolved,
      unresolved: outcome.unresolved,
      assetKeys: assetKeys.data,
    });

    const created = await this.createFlow(rewritten, input.importedByUserId);
    if (created.error) return err(created.error);

    const populated = await this.createNodesAndEdges(created.data, rewritten);
    if (populated.error) return err(populated.error);

    await this.auditLogger.log({
      actorId: input.importedByUserId,
      action: "flow.imported",
      resourceType: "flow",
      resourceId: created.data.id,
      metadata: {
        flowName: created.data.name,
        formatVersion: manifest.formatVersion,
        exportedFrom: manifest.exportedFrom.appVersion,
        assetCount: manifest.assets.length,
        unresolvedCount: outcome.unresolved.length,
      },
    });

    return ok({
      flow: populated.data,
      unresolved: outcome.unresolved,
      warnings: outcome.warnings,
    });
  }

  private async storeAssets(
    declared: FlowExportAsset[],
    bytesById: Map<string, Buffer>,
  ): Promise<Result<Record<string, string>>> {
    const assetKeys: Record<string, string> = {};

    for (const asset of declared) {
      const bytes = bytesById.get(asset.id);
      if (!bytes) {
        return err(
          domainError("VALIDATION_FAILED", `The archive is missing the bytes for asset "${asset.id}".`),
        );
      }

      const key = this.generateKey();
      const stored = await this.objectStorage.put(key, bytes, asset.mimeType);
      if (stored.error) return err(stored.error);

      assetKeys[asset.path] = stored.data.key;
    }

    return ok(assetKeys);
  }

  private async createFlow(snapshot: FlowSnapshot, ownerUserId: string): Promise<Result<Flow>> {
    const created = await this.flows.create({
      name: snapshot.flow.name,
      description: snapshot.flow.description,
      icon: snapshot.flow.icon,
      expertRole: snapshot.flow.expertRole,
      ownerUserId,
      flowType: snapshot.kind ?? "guided",
    });
    if (created.error) return err(created.error);

    let flow = created.data;

    for (const doc of snapshot.flow.contextDocs) {
      const added = await this.flows.addContextDoc(flow.id, { ...doc, id: crypto.randomUUID() });
      if (added.error) return err(added.error);
      flow = added.data;
    }

    return ok(flow);
  }

  // Nodes are created first so the database can allocate their ids, then
  // everything that refers to a node id is rewritten against what it actually
  // allocated: edges, and the node ids embedded in approval config. A node whose
  // config changes in that second pass is updated; most never do.
  private async createNodesAndEdges(flow: Flow, snapshot: FlowSnapshot): Promise<Result<Flow>> {
    const nodeIdMap: Record<string, string> = {};

    for (const node of snapshot.nodes) {
      const created = await this.flowNodes.create({
        flowId: flow.id,
        type: node.type,
        name: node.name,
        colour: node.colour,
        positionX: node.positionX,
        positionY: node.positionY,
        config: node.config,
      });
      if (created.error) return err(created.error);
      nodeIdMap[node.id] = created.data.id;
    }

    const remapped = remapNodeReferences(snapshot, nodeIdMap);
    if (remapped.error) return err(remapped.error);

    for (const [index, node] of remapped.data.nodes.entries()) {
      const original = snapshot.nodes[index]!;
      if (JSON.stringify(original.config) === JSON.stringify(node.config)) continue;

      const updated = await this.flowNodes.update(node.id, { config: node.config });
      if (updated.error) return err(updated.error);
    }

    for (const edge of remapped.data.edges) {
      const created = await this.flowEdges.create({
        flowId: flow.id,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        config: edge.config,
      });
      if (created.error) return err(created.error);
    }

    return ok(flow);
  }
}
