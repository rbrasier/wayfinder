import { describe, expect, it, vi } from "vitest";
import { ok } from "@rbrasier/domain";
import type {
  FlowLesson,
  FlowNode,
  FlowObservation,
  IAuditLogger,
  IFlowLessonRepository,
  IFlowNodeRepository,
  IFlowObservationRepository,
  ILessonDistiller,
  LessonCandidate,
  ObservationKind,
} from "@rbrasier/domain";
import { DistilFlowLessons } from "./distil-flow-lessons";

const observation = (
  id: string,
  kind: ObservationKind = "field_corrected",
  nodeId = "node-1",
): FlowObservation =>
  ({
    id,
    flowId: "flow-1",
    nodeId,
    sessionId: `session-${id}`,
    kind,
    detail: { kind: "field_corrected", corrections: [] },
    occurredAt: new Date("2026-02-01T00:00:00Z"),
    distilledAt: null,
    createdAt: new Date("2026-02-01T00:00:00Z"),
    updatedAt: new Date("2026-02-01T00:00:00Z"),
  }) as FlowObservation;

const node = (id: string): FlowNode =>
  ({
    id,
    flowId: "flow-1",
    type: "conversational",
    name: "Supplier details",
    colour: null,
    positionX: 0,
    positionY: 0,
    config: { aiInstruction: "Collect the supplier's details." },
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as FlowNode;

const makeDoubles = (options: {
  observations?: FlowObservation[];
  nodes?: FlowNode[];
  lessons?: FlowLesson[];
  candidates?: LessonCandidate[];
} = {}) => {
  const observations = {
    listUndistilledByFlow: vi.fn().mockResolvedValue(ok(options.observations ?? [])),
    markDistilled: vi.fn().mockResolvedValue(ok(undefined)),
  } as unknown as IFlowObservationRepository;

  const lessons = {
    listByFlow: vi.fn().mockResolvedValue(ok(options.lessons ?? [])),
    createProposed: vi.fn().mockResolvedValue(ok({ id: "lesson-new" } as FlowLesson)),
    retireForMissingNodes: vi.fn().mockResolvedValue(ok([])),
  } as unknown as IFlowLessonRepository;

  const distiller = {
    distil: vi.fn().mockResolvedValue(ok({ candidates: options.candidates ?? [] })),
  } as unknown as ILessonDistiller;

  const flowNodes = {
    listByFlow: vi.fn().mockResolvedValue(ok(options.nodes ?? [node("node-1")])),
  } as unknown as IFlowNodeRepository;

  const auditLogger = { log: vi.fn().mockResolvedValue(ok(true)) } as unknown as IAuditLogger;

  return { observations, lessons, distiller, flowNodes, auditLogger };
};

const run = (doubles: ReturnType<typeof makeDoubles>, evidenceThreshold = 3) =>
  new DistilFlowLessons(
    doubles.observations,
    doubles.lessons,
    doubles.distiller,
    doubles.flowNodes,
    doubles.auditLogger,
  ).execute({ flowId: "flow-1", evidenceThreshold });

describe("DistilFlowLessons", () => {
  it("does not call the distiller for a group below the evidence threshold", async () => {
    // One bad session is noise. Below the threshold a group stays latent rather
    // than becoming doctrine.
    const doubles = makeDoubles({ observations: [observation("o1"), observation("o2")] });

    await run(doubles);

    expect(doubles.distiller.distil).not.toHaveBeenCalled();
  });

  it("calls the distiller once a group reaches the threshold", async () => {
    const doubles = makeDoubles({
      observations: [observation("o1"), observation("o2"), observation("o3")],
    });

    await run(doubles);

    expect(doubles.distiller.distil).toHaveBeenCalledTimes(1);
  });

  it("groups by node and kind, not by node alone", async () => {
    const doubles = makeDoubles({
      observations: [
        observation("o1", "field_corrected"),
        observation("o2", "field_corrected"),
        observation("o3", "field_corrected"),
        observation("o4", "excess_turns"),
        observation("o5", "excess_turns"),
        observation("o6", "excess_turns"),
      ],
    });

    await run(doubles);

    expect(doubles.distiller.distil).toHaveBeenCalledTimes(2);
  });

  it("maps an efficiency signal to an efficiency lesson", async () => {
    const doubles = makeDoubles({
      observations: ["o1", "o2", "o3"].map((id) => observation(id, "excess_turns")),
    });

    await run(doubles);

    expect(doubles.distiller.distil).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "efficiency" }),
    );
  });

  it("maps a knowledge gap to a knowledge_gap lesson, which never reaches a prompt", async () => {
    const doubles = makeDoubles({
      observations: ["o1", "o2", "o3"].map((id) => observation(id, "knowledge_gap")),
    });

    await run(doubles);

    expect(doubles.distiller.distil).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "knowledge_gap" }),
    );
  });

  it("persists a valid candidate and marks its evidence distilled", async () => {
    const doubles = makeDoubles({
      observations: ["o1", "o2", "o3"].map((id) => observation(id)),
      candidates: [
        { nodeId: "node-1", kind: "guidance", statement: "Ask for the legal name." },
      ],
    });

    const result = await run(doubles);

    expect(result.data?.proposed).toBe(1);
    expect(doubles.lessons.createProposed).toHaveBeenCalledWith(
      expect.objectContaining({ statement: "Ask for the legal name." }),
      "flow-1",
      ["o1", "o2", "o3"],
    );
    expect(doubles.observations.markDistilled).toHaveBeenCalledWith(["o1", "o2", "o3"]);
  });

  it("reports a candidate naming another node as a reject rather than writing it", async () => {
    const doubles = makeDoubles({
      observations: ["o1", "o2", "o3"].map((id) => observation(id)),
      candidates: [
        { nodeId: "node-9", kind: "guidance", statement: "A rule about a different step." },
      ],
    });

    const result = await run(doubles);

    expect(result.data?.proposed).toBe(0);
    expect(result.data?.rejected).toEqual([
      { statement: "A rule about a different step.", reason: "names a different node" },
    ]);
    expect(doubles.lessons.createProposed).not.toHaveBeenCalled();
  });

  it("reports a candidate of an unexpected kind as a reject", async () => {
    const doubles = makeDoubles({
      observations: ["o1", "o2", "o3"].map((id) => observation(id)),
      candidates: [
        { nodeId: "node-1", kind: "knowledge_gap", statement: "A rule of the wrong kind." },
      ],
    });

    const result = await run(doubles);

    expect(result.data?.rejected[0]?.reason).toBe("unexpected kind");
    expect(doubles.lessons.createProposed).not.toHaveBeenCalled();
  });

  it("skips a group whose node has been deleted, without spending a model call", async () => {
    const doubles = makeDoubles({
      observations: ["o1", "o2", "o3"].map((id) => observation(id, "field_corrected", "node-gone")),
      nodes: [node("node-1")],
    });

    await run(doubles);

    expect(doubles.distiller.distil).not.toHaveBeenCalled();
    expect(doubles.observations.markDistilled).toHaveBeenCalledWith(["o1", "o2", "o3"]);
  });

  it("retires a lesson whose node no longer exists and audits each retirement", async () => {
    const orphan = {
      id: "lesson-orphan",
      flowId: "flow-1",
      nodeId: "node-gone",
      kind: "guidance",
      statement: "Guidance for a deleted step.",
      status: "accepted",
    } as FlowLesson;
    const doubles = makeDoubles({ lessons: [orphan] });
    vi.mocked(doubles.lessons.retireForMissingNodes).mockResolvedValue(ok([orphan]));

    const result = await run(doubles);

    expect(result.data?.retired).toBe(1);
    expect(doubles.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "flow_lesson.retired",
        metadata: expect.objectContaining({ reason: "node_removed", nodeId: "node-gone" }),
      }),
    );
  });

  it("retires nothing when every lesson's node still exists", async () => {
    const doubles = makeDoubles({
      lessons: [{ id: "l1", flowId: "flow-1", nodeId: "node-1", status: "accepted" } as FlowLesson],
    });

    const result = await run(doubles);

    expect(result.data?.retired).toBe(0);
    expect(doubles.lessons.retireForMissingNodes).not.toHaveBeenCalled();
  });

  it("shows the distiller the statements already accepted on that node", async () => {
    const doubles = makeDoubles({
      observations: ["o1", "o2", "o3"].map((id) => observation(id)),
      lessons: [
        {
          id: "l1",
          flowId: "flow-1",
          nodeId: "node-1",
          status: "accepted",
          statement: "An existing rule.",
        } as FlowLesson,
      ],
    });

    await run(doubles);

    expect(doubles.distiller.distil).toHaveBeenCalledWith(
      expect.objectContaining({ existingStatements: ["An existing rule."] }),
    );
  });
});
