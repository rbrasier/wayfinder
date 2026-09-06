import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok } from "@rbrasier/domain";
import type { FlowObservation, ILanguageModel, LessonDistillationRequest } from "@rbrasier/domain";
import { AiLessonDistiller } from "./ai-lesson-distiller";

const observation = (detail: FlowObservation["detail"]): FlowObservation => ({
  id: "obs-1",
  flowId: "flow-1",
  nodeId: "node-1",
  sessionId: "session-1",
  kind: detail.kind,
  detail,
  occurredAt: new Date("2026-03-01T00:00:00Z"),
  distilledAt: null,
  createdAt: new Date("2026-03-01T00:00:00Z"),
  updatedAt: new Date("2026-03-01T00:00:00Z"),
});

const request = (overrides: Partial<LessonDistillationRequest> = {}): LessonDistillationRequest => ({
  flowId: "flow-1",
  nodeId: "node-1",
  nodeName: "Supplier details",
  nodeInstruction: "Collect the supplier's details.",
  kind: "guidance",
  observations: [
    observation({
      kind: "field_corrected",
      corrections: [
        { key: "supplier", previousValue: "Acme", newValue: "Acme Holdings Limited" },
      ],
    }),
  ],
  existingStatements: [],
  ...overrides,
});

const modelReturning = (candidates: { statement: string }[]): ILanguageModel =>
  ({
    generateObject: vi.fn().mockResolvedValue(
      ok({ object: { candidates }, usage: {}, provider: "test", model: "test" }),
    ),
  }) as unknown as ILanguageModel;

describe("AiLessonDistiller", () => {
  it("returns a well-formed candidate", async () => {
    const model = modelReturning([
      { statement: "Ask for the supplier's registered legal name, not its trading name." },
    ]);

    const result = await new AiLessonDistiller(model).distil(request());

    expect(result.data?.candidates).toEqual([
      {
        nodeId: "node-1",
        kind: "guidance",
        statement: "Ask for the supplier's registered legal name, not its trading name.",
      },
    ]);
  });

  it("takes the node and kind from the request, never from the model", async () => {
    // A candidate cannot name a step it was not asked about, because it never
    // gets to name one at all.
    const model = modelReturning([{ statement: "Confirm the legal entity before generating." }]);

    const result = await new AiLessonDistiller(model).distil(
      request({ nodeId: "node-9", kind: "efficiency" }),
    );

    expect(result.data?.candidates[0]).toMatchObject({ nodeId: "node-9", kind: "efficiency" });
  });

  it("rejects a candidate that restates a verbatim value from its evidence", async () => {
    // The prompt instructs against it; this is the mechanical enforcement adopted
    // at /doc-review, so the leak never depends on the reviewer noticing.
    const model = modelReturning([
      { statement: "Always record the supplier as Acme Holdings Limited." },
    ]);

    const result = await new AiLessonDistiller(model).distil(request());

    expect(result.data?.candidates).toEqual([]);
  });

  it("keeps a general rule that merely shares short words with the evidence", async () => {
    const model = modelReturning([{ statement: "Ask for the registered legal name." }]);

    const result = await new AiLessonDistiller(model).distil(request());

    expect(result.data?.candidates).toHaveLength(1);
  });

  it("drops an empty statement", async () => {
    const result = await new AiLessonDistiller(modelReturning([{ statement: "   " }])).distil(
      request(),
    );

    expect(result.data?.candidates).toEqual([]);
  });

  it("drops a statement past the length bound", async () => {
    const result = await new AiLessonDistiller(
      modelReturning([{ statement: "a".repeat(301) }]),
    ).distil(request());

    expect(result.data?.candidates).toEqual([]);
  });

  it("caps the number of candidates it will return", async () => {
    const model = modelReturning([
      { statement: "First general rule about naming." },
      { statement: "Second general rule about ordering." },
      { statement: "Third general rule about checking." },
      { statement: "Fourth general rule about confirming." },
    ]);

    const result = await new AiLessonDistiller(model).distil(request());

    expect(result.data?.candidates.length).toBeLessThanOrEqual(3);
  });

  it("attributes the call to the flow so the spend is counted against it", async () => {
    const model = modelReturning([{ statement: "Ask for the registered legal name." }]);

    await new AiLessonDistiller(model).distil(request());

    expect(model.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "flow-lesson-distillation", flowId: "flow-1" }),
    );
  });

  it("shows the distiller the statements already accepted on the step", async () => {
    const model = modelReturning([{ statement: "Ask for the registered legal name." }]);

    await new AiLessonDistiller(model).distil(
      request({ existingStatements: ["An existing accepted rule."] }),
    );

    expect(vi.mocked(model.generateObject).mock.calls[0]![0].prompt).toContain(
      "An existing accepted rule.",
    );
  });

  it("passes a model failure back rather than inventing candidates", async () => {
    const model = {
      generateObject: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "Model down."))),
    } as unknown as ILanguageModel;

    const result = await new AiLessonDistiller(model).distil(request());

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(result.data).toBeUndefined();
  });
});
