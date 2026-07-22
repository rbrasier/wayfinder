import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type { ILanguageModel } from "@rbrasier/domain";
import type { FileGroupingData } from "@rbrasier/shared";
import {
  oneRecordPerFile,
  selectRecordFiles,
  type SelectableFile,
} from "./select-record-files";

const usage = {
  promptTokens: 10,
  completionTokens: 5,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const files: SelectableFile[] = [
  { id: "f1", filename: "acme-cover.pdf", treePath: "acme/cover.pdf" },
  { id: "f2", filename: "acme-pricing.pdf", treePath: "acme/pricing.pdf" },
  { id: "f3", filename: "globex-cover.pdf", treePath: "globex/cover.pdf" },
];

const makeModel = (grouping: FileGroupingData): ILanguageModel =>
  ({
    provider: "anthropic",
    generateObject: vi.fn().mockResolvedValue(ok({ object: grouping, usage })),
    generateText: vi.fn(),
    streamText: vi.fn(),
    streamObject: vi.fn(),
  }) as unknown as ILanguageModel;

describe("oneRecordPerFile", () => {
  it("maps each file to its own record with no exceptions", () => {
    const grouping = oneRecordPerFile(files);

    expect(grouping.groups).toHaveLength(3);
    expect(grouping.groups[0]).toEqual({ label: "acme-cover.pdf", fileIds: ["f1"] });
    expect(grouping.exceptionFileIds).toEqual([]);
  });
});

describe("selectRecordFiles", () => {
  it("groups files per the model's records and passes criteria to the model", async () => {
    const model = makeModel({
      records: [
        { label: "Acme", fileIds: ["f1", "f2"] },
        { label: "Globex", fileIds: ["f3"] },
      ],
    });

    const result = await selectRecordFiles(model, {
      files,
      selectionCriteria: "group files in the same sub-folder",
    });

    expect(result.error).toBeUndefined();
    expect(result.data!.groups).toEqual([
      { label: "Acme", fileIds: ["f1", "f2"] },
      { label: "Globex", fileIds: ["f3"] },
    ]);
    expect(result.data!.exceptionFileIds).toEqual([]);

    const call = (model.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.prompt).toContain("group files in the same sub-folder");
    expect(call.prompt).toContain("f1");
  });

  it("routes a file matched by no record to exceptions", async () => {
    const model = makeModel({ records: [{ label: "Acme", fileIds: ["f1", "f2"] }] });

    const result = await selectRecordFiles(model, {
      files,
      selectionCriteria: "files with the acme prefix",
    });

    expect(result.data!.exceptionFileIds).toEqual(["f3"]);
  });

  it("assigns a file matched by several records to all of them (over-matching allowed)", async () => {
    const model = makeModel({
      records: [
        { label: "A", fileIds: ["f1", "f3"] },
        { label: "B", fileIds: ["f2", "f3"] },
      ],
    });

    const result = await selectRecordFiles(model, {
      files,
      selectionCriteria: "any grouping",
    });

    const groupsWithF3 = result.data!.groups.filter((group) => group.fileIds.includes("f3"));
    expect(groupsWithF3).toHaveLength(2);
    expect(result.data!.exceptionFileIds).toEqual([]);
  });

  it("drops unknown file ids the model hallucinates and empty records", async () => {
    const model = makeModel({
      records: [
        { label: "Real", fileIds: ["f1", "ghost"] },
        { label: "Empty", fileIds: ["also-ghost"] },
      ],
    });

    const result = await selectRecordFiles(model, {
      files,
      selectionCriteria: "any",
    });

    expect(result.data!.groups).toEqual([{ label: "Real", fileIds: ["f1"] }]);
    expect(result.data!.exceptionFileIds.sort()).toEqual(["f2", "f3"]);
  });

  it("propagates a model error", async () => {
    const model = {
      provider: "anthropic",
      generateObject: vi.fn().mockResolvedValue(err(domainError("AI_PROVIDER_FAILED", "boom"))),
      generateText: vi.fn(),
      streamText: vi.fn(),
      streamObject: vi.fn(),
    } as unknown as ILanguageModel;

    const result = await selectRecordFiles(model, { files, selectionCriteria: "x" });

    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
  });
});
