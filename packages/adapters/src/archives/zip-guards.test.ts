import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { guardEntryCount, guardDeclaredSizes, isUnsafePath, openZip, readableEntries } from "./zip-guards";

const zipWith = (files: Record<string, string>): Buffer => {
  const zip = new PizZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generate({ type: "nodebuffer" });
};

describe("isUnsafePath", () => {
  it.each([
    ["../escape.txt", "a parent segment"],
    ["nested/../../escape.txt", "a parent segment part-way through"],
    ["/absolute.txt", "an absolute path"],
    ["\\windows-absolute.txt", "a windows absolute path"],
    ["C:/drive.txt", "a drive letter"],
    ["nested\\..\\escape.txt", "backslash separators around a parent segment"],
  ])("rejects %s (%s)", (path) => {
    expect(isUnsafePath(path)).toBe(true);
  });

  it.each([["report.docx"], ["nested/report.docx"], ["deeply/nested/path/report.docx"], ["a..b/file.txt"]])(
    "accepts %s",
    (path) => {
      expect(isUnsafePath(path)).toBe(false);
    },
  );
});

describe("openZip", () => {
  it("opens a readable archive", () => {
    const result = openZip(zipWith({ "a.txt": "hello" }));

    expect(result.error).toBeUndefined();
    expect(result.data!.files["a.txt"]).toBeDefined();
  });

  it("returns a Result error for bytes that are not a zip, rather than throwing", () => {
    const result = openZip(Buffer.from("definitely not a zip"));

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("zip");
  });
});

describe("readableEntries", () => {
  it("returns the files and leaves directory entries out", () => {
    const zip = new PizZip();
    zip.folder("nested");
    zip.file("nested/a.txt", "hello");

    const entries = readableEntries(new PizZip(zip.generate({ type: "nodebuffer" })));

    expect(entries.map((entry) => entry.name)).toEqual(["nested/a.txt"]);
  });
});

describe("guardEntryCount", () => {
  it("passes an archive within the limit", () => {
    const entries = readableEntries(openZip(zipWith({ "a.txt": "1", "b.txt": "2" })).data!);

    expect(guardEntryCount(entries, 2).error).toBeUndefined();
  });

  it("rejects an archive over the limit, naming both numbers", () => {
    const entries = readableEntries(openZip(zipWith({ "a.txt": "1", "b.txt": "2", "c.txt": "3" })).data!);

    const result = guardEntryCount(entries, 2);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("3");
    expect(result.error?.message).toContain("2");
  });
});

describe("guardDeclaredSizes", () => {
  it("passes entries within both caps", () => {
    const entries = readableEntries(openZip(zipWith({ "a.txt": "hello" })).data!);

    expect(guardDeclaredSizes(entries, { maxEntryBytes: 1024, maxTotalBytes: 1024 }).error).toBeUndefined();
  });

  it("rejects an entry whose declared size is over the per-entry cap, before decompressing it", () => {
    const entries = readableEntries(openZip(zipWith({ "big.txt": "x".repeat(500) })).data!);

    const result = guardDeclaredSizes(entries, { maxEntryBytes: 100, maxTotalBytes: 10_000 });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("big.txt");
  });

  it("rejects an archive whose declared total is over the bomb cap", () => {
    const entries = readableEntries(
      openZip(zipWith({ "a.txt": "x".repeat(400), "b.txt": "y".repeat(400) })).data!,
    );

    const result = guardDeclaredSizes(entries, { maxEntryBytes: 1000, maxTotalBytes: 500 });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("bomb");
  });
});
