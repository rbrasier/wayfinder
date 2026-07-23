import { describe, expect, it, vi } from "vitest";
import {
  domainError,
  err,
  ok,
  type ExtractionFieldResult,
  type ExtractionRecord,
  type Result,
} from "@rbrasier/domain";
import { EditRecordField } from "./edit-record-field";

const record: ExtractionRecord = {
  id: "rec-1",
  label: "Acme",
  fields: [{ key: "supplier", value: "Acme", confidence: 0.4, rationale: "guessed" }],
  sourceDocumentIds: ["doc-1"],
};

const buildDeps = (found: ExtractionRecord | null = record) => {
  let saved: ExtractionFieldResult[] | null = null;
  const runs = {
    getRecord: vi.fn(async (): Promise<Result<ExtractionRecord | null>> => ok(found)),
    saveRecordFields: vi.fn(async (_id: string, fields: ExtractionFieldResult[]): Promise<Result<void>> => {
      saved = fields;
      return ok(undefined);
    }),
  };
  const auditLogger = { log: vi.fn(async () => ok(true as const)) };
  return {
    runs,
    auditLogger,
    getSaved: () => saved,
    useCase: new EditRecordField(runs as never, auditLogger as never),
  };
};

describe("EditRecordField", () => {
  it("saves the corrected value and stamps the field human-verified", async () => {
    const deps = buildDeps();
    const result = await deps.useCase.execute({
      recordId: "rec-1",
      fieldKey: "supplier",
      newValue: "Acme Ltd",
      editorUserId: "user-1",
      editorLabel: "Dana",
    });

    expect(result.error).toBeUndefined();
    const saved = deps.getSaved()!;
    expect(saved[0]).toMatchObject({ key: "supplier", value: "Acme Ltd", confidence: 1 });
  });

  it("writes an audit event carrying the before/after values (no AI re-run)", async () => {
    const deps = buildDeps();
    await deps.useCase.execute({
      recordId: "rec-1",
      fieldKey: "supplier",
      newValue: "Acme Ltd",
      editorUserId: "user-1",
      editorLabel: "Dana",
    });

    expect(deps.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        action: "extraction_record.edited",
        resourceType: "extraction_record",
        resourceId: "rec-1",
        metadata: expect.objectContaining({
          fieldKey: "supplier",
          previousValue: "Acme",
          newValue: "Acme Ltd",
        }),
      }),
    );
  });

  it("fails when the record does not exist", async () => {
    const deps = buildDeps(null);
    const result = await deps.useCase.execute({
      recordId: "missing",
      fieldKey: "supplier",
      newValue: "x",
      editorUserId: "user-1",
      editorLabel: "Dana",
    });
    expect(result.error?.code).toBe("NOT_FOUND");
    expect(deps.runs.saveRecordFields).not.toHaveBeenCalled();
  });

  it("fails when the field key is not on the record", async () => {
    const deps = buildDeps();
    const result = await deps.useCase.execute({
      recordId: "rec-1",
      fieldKey: "unknown",
      newValue: "x",
      editorUserId: "user-1",
      editorLabel: "Dana",
    });
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("surfaces a repository save failure", async () => {
    const deps = buildDeps();
    deps.runs.saveRecordFields.mockResolvedValueOnce(err(domainError("INFRA_FAILURE", "db down")));
    const result = await deps.useCase.execute({
      recordId: "rec-1",
      fieldKey: "supplier",
      newValue: "Acme Ltd",
      editorUserId: "user-1",
      editorLabel: "Dana",
    });
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
