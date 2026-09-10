import { buildFlowSnapshot, domainError, err, ok, remapNodeReferences } from "@wayfinder/domain";
import type {
  Flow,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  IFlowRepository,
  IObjectStorage,
  Result,
} from "@wayfinder/domain";
import { canExportFlow } from "./export-flow";
import type { GenerateStorageKey } from "./import-flow";

export interface DuplicateFlowInput {
  flowId: string;
  requestedByUserId: string;
  isAdmin: boolean;
}

const defaultGenerateKey: GenerateStorageKey = () => `flows/duplicated/${crypto.randomUUID()}`;

// Clones a flow in place, with no file round-trip.
//
// The copy gets its *own* objects rather than sharing storage keys with the
// original. Sharing would be cheaper, and would mean deleting one flow's
// template silently breaks the other's document generation — so the storage
// growth is accepted deliberately (ADR-049, PRD §12).
export class DuplicateFlow {
  constructor(
    private readonly flows: IFlowRepository,
    private readonly flowNodes: IFlowNodeRepository,
    private readonly flowEdges: IFlowEdgeRepository,
    private readonly objectStorage: IObjectStorage,
    private readonly generateKey: GenerateStorageKey = defaultGenerateKey,
  ) {}

  async execute(input: DuplicateFlowInput): Promise<Result<Flow>> {
    const flowResult = await this.flows.findById(input.flowId);
    if (flowResult.error) return err(flowResult.error);
    if (!flowResult.data) return err(domainError("NOT_FOUND", "Flow not found."));

    const source = flowResult.data;
    if (!canExportFlow(source, input.requestedByUserId, input.isAdmin)) {
      return err(domainError("FORBIDDEN", "Only the flow's owner or an admin can duplicate it."));
    }

    const nodesResult = await this.flowNodes.listByFlow(source.id);
    if (nodesResult.error) return err(nodesResult.error);

    const edgesResult = await this.flowEdges.listByFlow(source.id);
    if (edgesResult.error) return err(edgesResult.error);

    const snapshot = buildFlowSnapshot(source, nodesResult.data, edgesResult.data);

    const copiedKeys = await this.copyAssets(snapshot);
    if (copiedKeys.error) return err(copiedKeys.error);

    const created = await this.flows.create({
      name: `${source.name} (copy)`,
      description: source.description,
      icon: source.icon,
      expertRole: source.expertRole,
      ownerUserId: input.requestedByUserId,
      flowType: source.flowType,
    });
    if (created.error) return err(created.error);

    let copy = created.data;

    for (const doc of source.contextDocs) {
      const added = await this.flows.addContextDoc(copy.id, {
        ...doc,
        id: crypto.randomUUID(),
        storagePath: copiedKeys.data[doc.storagePath] ?? doc.storagePath,
      });
      if (added.error) return err(added.error);
      copy = added.data;
    }

    const nodeIdMap: Record<string, string> = {};

    for (const node of snapshot.nodes) {
      const config = { ...node.config };
      if (typeof config.documentTemplatePath === "string") {
        const key = copiedKeys.data[config.documentTemplatePath];
        if (key) config.documentTemplatePath = key;
      }

      const createdNode = await this.flowNodes.create({
        flowId: copy.id,
        type: node.type,
        name: node.name,
        colour: node.colour,
        positionX: node.positionX,
        positionY: node.positionY,
        config,
      });
      if (createdNode.error) return err(createdNode.error);
      nodeIdMap[node.id] = createdNode.data.id;
    }

    const remapped = remapNodeReferences(snapshot, nodeIdMap);
    if (remapped.error) return err(remapped.error);

    for (const [index, node] of remapped.data.nodes.entries()) {
      const original = snapshot.nodes[index]!;
      if (JSON.stringify(original.config) === JSON.stringify(node.config)) continue;

      const stored = await this.flowNodes.findById(node.id);
      if (stored.error) return err(stored.error);

      const config = { ...node.config };
      // Keep the copied template key the node was created with; the remap pass
      // only knows about node ids.
      if (stored.data && typeof stored.data.config.documentTemplatePath === "string") {
        config.documentTemplatePath = stored.data.config.documentTemplatePath;
      }

      const updated = await this.flowNodes.update(node.id, { config });
      if (updated.error) return err(updated.error);
    }

    for (const edge of remapped.data.edges) {
      const createdEdge = await this.flowEdges.create({
        flowId: copy.id,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        config: edge.config,
      });
      if (createdEdge.error) return err(createdEdge.error);
    }

    return ok(copy);
  }

  // Source storage key → the copy's own key.
  private async copyAssets(
    snapshot: ReturnType<typeof buildFlowSnapshot>,
  ): Promise<Result<Record<string, string>>> {
    const paths = new Set<string>();

    for (const doc of snapshot.flow.contextDocs) paths.add(doc.storagePath);
    for (const node of snapshot.nodes) {
      const path = node.config.documentTemplatePath;
      if (typeof path === "string" && path !== "") paths.add(path);
    }

    const copied: Record<string, string> = {};

    for (const path of paths) {
      const bytes = await this.objectStorage.get(path);
      if (bytes.error) return err(bytes.error);

      const mimeType =
        snapshot.flow.contextDocs.find((doc) => doc.storagePath === path)?.mimeType ??
        "application/octet-stream";

      const key = this.generateKey();
      const stored = await this.objectStorage.put(key, bytes.data, mimeType);
      if (stored.error) return err(stored.error);

      copied[path] = stored.data.key;
    }

    return ok(copied);
  }
}
