import {
  buildFlowSnapshot,
  collectDependencies,
  domainError,
  err,
  FLOW_EXPORT_FORMAT_VERSION,
  ok,
} from "@wayfinder/domain";
import type {
  Flow,
  FlowArchiveAsset,
  FlowExportAsset,
  FlowExportDependency,
  FlowExportManifest,
  IAuditLogger,
  IFlowArchiveWriter,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  IFlowRepository,
  IMcpServerRepository,
  IObjectStorage,
  ISkillRepository,
  Result,
  Sha256Bytes,
} from "@wayfinder/domain";

export interface ExportFlowInput {
  flowId: string;
  requestedByUserId: string;
  isAdmin: boolean;
}

export interface ExportFlowOutput {
  filename: string;
  archive: Buffer;
}

// Restricted to the flow's owner or an admin (ADR-049 §9). No separate
// PermissionKey exists: the registry is developer-owned and a key with no
// distinct enforcement would be meaningless.
export const canExportFlow = (flow: Flow, userId: string, isAdmin: boolean): boolean =>
  isAdmin ||
  flow.ownerUserId === userId ||
  flow.permissions.some((permission) => permission.userId === userId && permission.role === "owner");

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "flow";

// Assembles the portable archive: the existing publish-time snapshot, the
// dependencies it needs from its host resolved to portable names, and the
// binaries those two refer to.
//
// Nothing here reads a session, message, document or approval — the exporter is
// not wired to those repositories at all, which is a stronger guarantee than
// filtering them out would be.
export class ExportFlow {
  constructor(
    private readonly flows: IFlowRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly skills: ISkillRepository,
    private readonly mcpServers: IMcpServerRepository,
    private readonly objectStorage: IObjectStorage,
    private readonly archiveWriter: IFlowArchiveWriter,
    private readonly auditLogger: IAuditLogger,
    private readonly appVersion: string,
    // Injected rather than imported: packages/application may not reach outside
    // @wayfinder/domain and @wayfinder/shared, node:crypto included.
    private readonly sha256Bytes: Sha256Bytes,
  ) {}

  async execute(input: ExportFlowInput): Promise<Result<ExportFlowOutput>> {
    const flowResult = await this.flows.findById(input.flowId);
    if (flowResult.error) return err(flowResult.error);
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));

    const flow = flowResult.data;
    if (!canExportFlow(flow, input.requestedByUserId, input.isAdmin)) {
      return err(domainError("FORBIDDEN", "Only the flow's owner or an admin can export it."));
    }

    const nodesResult = await this.flowNodes.listByFlow(flow.id);
    if (nodesResult.error) return err(nodesResult.error);

    const edgesResult = await this.flowEdges.listByFlow(flow.id);
    if (edgesResult.error) return err(edgesResult.error);

    const snapshot = buildFlowSnapshot(flow, nodesResult.data, edgesResult.data);

    const dependencies = await this.portableDependencies(snapshot);
    if (dependencies.error) return err(dependencies.error);

    const assets = await this.bundleAssets(flow, snapshot);
    if (assets.error) return err(assets.error);

    const manifest: FlowExportManifest = {
      formatVersion: FLOW_EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      exportedFrom: { appVersion: this.appVersion },
      snapshot,
      dependencies: dependencies.data,
      assets: assets.data.map((entry) => entry.asset),
    };

    const written = await this.archiveWriter.write(manifest, assets.data);
    if (written.error) return err(written.error);

    await this.auditLogger.log({
      actorId: input.requestedByUserId,
      action: "flow.exported",
      resourceType: "flow",
      resourceId: flow.id,
      metadata: {
        flowName: flow.name,
        assetCount: manifest.assets.length,
        dependencyCount: manifest.dependencies.length,
        formatVersion: manifest.formatVersion,
      },
    });

    const date = manifest.exportedAt.slice(0, 10);

    return ok({ filename: `${slugify(flow.name)}-${date}.zip`, archive: written.data });
  }

  // Turns the ids a snapshot holds into the names another deployment can match.
  // `sourceId` is kept as the join key back into the snapshot, whose config
  // still holds the exporting deployment's ids.
  private async portableDependencies(
    snapshot: ReturnType<typeof buildFlowSnapshot>,
  ): Promise<Result<FlowExportDependency[]>> {
    const refs = collectDependencies(snapshot);
    if (refs.length === 0) return ok([]);

    const dependencies: FlowExportDependency[] = [];

    for (const ref of refs) {
      if (ref.kind === "skill") {
        const skill = await this.skills.findById(ref.localId);
        if (skill.error) return err(skill.error);
        if (!skill.data) {
          return err(
            domainError(
              "VALIDATION_FAILED",
              `This flow applies a skill that no longer exists (${ref.localId}). Remove it from the step before exporting.`,
            ),
          );
        }
        dependencies.push({
          kind: "skill",
          sourceId: ref.localId,
          name: skill.data.name,
          nodeIds: ref.nodeIds,
        });
        continue;
      }

      const server = await this.mcpServers.findById(ref.localId);
      if (server.error) return err(server.error);
      if (!server.data) {
        return err(
          domainError(
            "VALIDATION_FAILED",
            `This flow calls an MCP server that no longer exists (${ref.localId}). Remove it from the step before exporting.`,
          ),
        );
      }
      dependencies.push({
        kind: "mcp_tool",
        sourceId: ref.localId,
        name: server.data.label,
        toolName: ref.toolName,
        nodeIds: ref.nodeIds,
      });
    }

    return ok(dependencies);
  }

  private async bundleAssets(
    flow: Flow,
    snapshot: ReturnType<typeof buildFlowSnapshot>,
  ): Promise<Result<FlowArchiveAsset[]>> {
    const wanted: { path: string; kind: FlowExportAsset["kind"]; filename: string; mimeType: string }[] = [];

    for (const doc of flow.contextDocs) {
      wanted.push({
        path: doc.storagePath,
        kind: "context_doc",
        filename: doc.filename,
        mimeType: doc.mimeType,
      });
    }

    for (const node of snapshot.nodes) {
      const path = node.config.documentTemplatePath;
      if (typeof path !== "string" || path === "") continue;

      const filename = node.config.documentTemplateFilename;
      const format = node.config.documentTemplateFormat;
      wanted.push({
        path,
        kind: "template",
        filename: typeof filename === "string" ? filename : path.split("/").pop() ?? "template",
        mimeType:
          format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    }

    const assets: FlowArchiveAsset[] = [];
    const seen = new Set<string>();

    for (const [index, entry] of wanted.entries()) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);

      const bytes = await this.objectStorage.get(entry.path);
      if (bytes.error) return err(bytes.error);

      assets.push({
        asset: {
          id: `asset-${index + 1}`,
          kind: entry.kind,
          path: entry.path,
          filename: entry.filename,
          mimeType: entry.mimeType,
          sizeBytes: bytes.data.length,
          sha256: this.sha256Bytes(bytes.data),
        },
        bytes: bytes.data,
      });
    }

    return ok(assets);
  }
}
