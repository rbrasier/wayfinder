import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@wayfinder/domain";
import type { ILanguageModel } from "@wayfinder/domain";
import type { FileGroupingData } from "@wayfinder/shared";
import {
  groupingOutputBudget,
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

  it("gives the model an output budget scaled to the file count", async () => {
    const model = makeModel({ records: [{ label: "Acme", fileIds: ["f1"] }] });

    await selectRecordFiles(model, { files, selectionCriteria: "x" });

    const call = (model.generateObject as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.maxTokens).toBe(groupingOutputBudget(files.length));
  });

  it("retries once when the first grouping reply is rejected", async () => {
    const generateObject = vi
      .fn()
      .mockResolvedValueOnce(err(domainError("AI_PROVIDER_FAILED", "generateObject failed.")))
      .mockResolvedValueOnce(ok({ object: { records: [{ label: "Acme", fileIds: ["f1"] }] }, usage }));
    const model = { provider: "anthropic", generateObject } as unknown as ILanguageModel;

    const result = await selectRecordFiles(model, { files, selectionCriteria: "x" });

    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(result.data!.groups).toEqual([{ label: "Acme", fileIds: ["f1"] }]);
  });

  it("fails with a plain-English message after the retry also fails", async () => {
    const generateObject = vi
      .fn()
      .mockResolvedValue(err(domainError("AI_PROVIDER_FAILED", "generateObject failed.")));
    const model = { provider: "anthropic", generateObject } as unknown as ILanguageModel;

    const result = await selectRecordFiles(model, { files, selectionCriteria: "x" });

    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(result.error?.code).toBe("AI_PROVIDER_FAILED");
    expect(result.error?.message).toContain("could not group the files into records");
  });

  it("does not retry a quota refusal", async () => {
    const generateObject = vi
      .fn()
      .mockResolvedValue(err(domainError("QUOTA_EXCEEDED", "Monthly budget reached.")));
    const model = { provider: "anthropic", generateObject } as unknown as ILanguageModel;

    const result = await selectRecordFiles(model, { files, selectionCriteria: "x" });

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(result.error?.code).toBe("QUOTA_EXCEEDED");
  });
});

describe("groupingOutputBudget", () => {
  it("never drops below the provider default and never exceeds 8192", () => {
    expect(groupingOutputBudget(1)).toBe(4096);
    expect(groupingOutputBudget(10_000)).toBe(8192);
  });

  it("grows with the file count in between", () => {
    expect(groupingOutputBudget(80)).toBeGreaterThan(groupingOutputBudget(40));
  });
});
