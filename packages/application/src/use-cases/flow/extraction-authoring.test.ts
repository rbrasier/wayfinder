import { describe, expect, it, beforeEach } from "vitest";
import { domainError, err, ok, isExtractionSnapshot } from "@rbrasier/domain";
import type {
  ExtractionSchemaDraft,
  Flow,
  FlowVersion,
  IFlowRepository,
  IFlowVersionRepository,
  NewFlow,
  Result,
  UpsertDraftVersion,
} from "@rbrasier/domain";
import {
  CreateExtractionFlow,
  GetExtractionSchema,
  ListExtractionFlows,
  SaveExtractionSchema,
} from "./extraction-authoring";

const makeFlow = (overrides: Partial<Flow> = {}): Flow => ({
  id: "flow-1",
  name: "Supplier Intake",
  description: null,
  icon: null,
  expertRole: null,
  ownerUserId: "user-1",
  flowType: "extraction",
  status: "draft",
  visibility: { kind: "private" },
  permissions: [{ userId: "user-1", role: "owner" }],
  contextDocs: [],
  deletedAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

const draft: ExtractionSchemaDraft = {
  fields: [
    { label: "Supplier Name", annotation: "Supplier Name", instruction: "The legal name.", doneWhen: null },
  ],
  input: { cardinality: "one_per_file", selectionCriteria: null, guidance: "Read each file." },
  output: {
    format: "xlsx",
    outputTemplate: null,
    instruction: "One row per supplier.",
    generateSummary: false,
    summaryTemplate: null,
    contextDocs: [],
  },
};

class FakeFlowRepository implements IFlowRepository {
  flows = new Map<string, Flow>();
  created: NewFlow[] = [];
  async create(input: NewFlow): Promise<Result<Flow>> {
    this.created.push(input);
    const flow = makeFlow({ id: `flow-${this.flows.size + 1}`, name: input.name, flowType: input.flowType ?? "guided" });
    this.flows.set(flow.id, flow);
    return ok(flow);
  }
  async findById(id: string): Promise<Result<Flow | null>> { return ok(this.flows.get(id) ?? null); }
  async list(): Promise<Result<Flow[]>> { return ok([]); }
  async listForUser(): Promise<Result<Flow[]>> { return ok([]); }
  async listExtraction(): Promise<Result<Flow[]>> {
    return ok([...this.flows.values()].filter((flow) => flow.flowType === "extraction"));
  }
  async listExtractionForUser(userId: string): Promise<Result<Flow[]>> {
    return ok([...this.flows.values()].filter((flow) => flow.flowType === "extraction" && flow.ownerUserId === userId));
  }
  async update(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "nope")); }
  async softDelete(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "nope")); }
  async addContextDoc(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "nope")); }
  async removeContextDoc(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "nope")); }
  async setPermission(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "nope")); }
}

class FakeFlowVersionRepository implements Partial<IFlowVersionRepository> {
  drafts = new Map<string, FlowVersion>();
  published = new Map<string, FlowVersion>();
  async upsertDraft(input: UpsertDraftVersion): Promise<Result<FlowVersion>> {
    const version: FlowVersion = {
      id: `draft-${input.flowId}`,
      flowId: input.flowId,
      versionNumber: null,
      status: "draft",
      snapshot: input.snapshot,
      changeSummary: null,
      publishedByUserId: null,
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.drafts.set(input.flowId, version);
    return ok(version);
  }
  async openDraft(flowId: string): Promise<Result<FlowVersion | null>> {
    return ok(this.drafts.get(flowId) ?? null);
  }
  async latestPublished(flowId: string): Promise<Result<FlowVersion | null>> {
    return ok(this.published.get(flowId) ?? null);
  }
}

describe("CreateExtractionFlow", () => {
  it("creates a flow with flowType extraction", async () => {
    const flows = new FakeFlowRepository();
    const result = await new CreateExtractionFlow(flows).execute({ name: "RFP 24", ownerUserId: "user-1" });

    expect(result.error).toBeUndefined();
    expect(result.data!.flowType).toBe("extraction");
    expect(flows.created[0]!.flowType).toBe("extraction");
  });
});

describe("SaveExtractionSchema", () => {
  let flows: FakeFlowRepository;
  let versions: FakeFlowVersionRepository;
  let useCase: SaveExtractionSchema;

  beforeEach(() => {
    flows = new FakeFlowRepository();
    versions = new FakeFlowVersionRepository();
    flows.flows.set("flow-1", makeFlow());
    useCase = new SaveExtractionSchema(flows, versions as unknown as IFlowVersionRepository);
  });

  it("stores the parsed schema in an extraction draft snapshot", async () => {
    const result = await useCase.execute({ flowId: "flow-1", schema: draft });

    expect(result.error).toBeUndefined();
    const snapshot = versions.drafts.get("flow-1")!.snapshot;
    expect(isExtractionSnapshot(snapshot)).toBe(true);
    expect(snapshot.extraction!.fields[0]!.field.key).toBe("supplier_name");
  });

  it("rejects saving a schema onto a guided flow", async () => {
    flows.flows.set("guided", makeFlow({ id: "guided", flowType: "guided" }));
    const result = await useCase.execute({ flowId: "guided", schema: draft });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("propagates a schema validation error (no fields)", async () => {
    const result = await useCase.execute({
      flowId: "flow-1",
      schema: { ...draft, fields: [] },
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns NOT_FOUND for an unknown flow", async () => {
    const result = await useCase.execute({ flowId: "ghost", schema: draft });

    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("GetExtractionSchema", () => {
  it("reads the draft schema when a draft is open", async () => {
    const flows = new FakeFlowRepository();
    const versions = new FakeFlowVersionRepository();
    flows.flows.set("flow-1", makeFlow());
    await new SaveExtractionSchema(flows, versions as unknown as IFlowVersionRepository).execute({ flowId: "flow-1", schema: draft });

    const result = await new GetExtractionSchema(versions as unknown as IFlowVersionRepository).execute("flow-1");

    expect(result.data!.fields[0]!.field.label).toBe("Supplier Name");
  });

  it("returns null when nothing has been authored", async () => {
    const versions = new FakeFlowVersionRepository();
    const result = await new GetExtractionSchema(versions as unknown as IFlowVersionRepository).execute("flow-1");

    expect(result.data).toBeNull();
  });
});

describe("ListExtractionFlows", () => {
  it("returns only extraction flows", async () => {
    const flows = new FakeFlowRepository();
    flows.flows.set("g", makeFlow({ id: "g", flowType: "guided" }));
    flows.flows.set("e", makeFlow({ id: "e", flowType: "extraction" }));

    const result = await new ListExtractionFlows(flows).execute();

    expect(result.data!.map((flow) => flow.id)).toEqual(["e"]);
  });
});
