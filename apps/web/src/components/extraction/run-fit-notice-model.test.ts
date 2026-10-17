import { describe, expect, it } from "vitest";
import type { RunFitEstimate } from "@wayfinder/domain";
import { runFitNotices } from "./run-fit-notice-model";

const fits: RunFitEstimate = {
  blocking: false,
  documentsToSplit: [],
  unknownSizeCount: 0,
  contextTruncated: false,
  summaryCoverage: null,
};

describe("runFitNotices", () => {
  it("shows nothing before an estimate exists or when the run fits", () => {
    expect(runFitNotices(null)).toEqual([]);
    expect(runFitNotices(fits)).toEqual([]);
  });

  it("shows only the blocking notice when the instructions alone do not fit", () => {
    const notices = runFitNotices({ ...fits, blocking: true, unknownSizeCount: 2, contextTruncated: true });

    expect(notices).toHaveLength(1);
    expect(notices[0]!.tone).toBe("block");
    expect(notices[0]!.message).toMatch(/context material/i);
    expect(notices[0]!.message).toMatch(/shorten|remove/i);
  });

  it("names a single document that will be read in parts", () => {
    const notices = runFitNotices({
      ...fits,
      documentsToSplit: [{ documentId: "d1", filename: "feed.txt", parts: 3 }],
    });

    expect(notices).toEqual([
      { tone: "note", message: "feed.txt is larger than one model call and will be read in about 3 parts." },
    ]);
  });

  it("summarises several split documents by count and the largest part count", () => {
    const notices = runFitNotices({
      ...fits,
      documentsToSplit: [
        { documentId: "d1", filename: "a.txt", parts: 2 },
        { documentId: "d2", filename: "b.txt", parts: 5 },
      ],
    });

    expect(notices[0]!.message).toBe(
      "2 documents are larger than one model call and will be read in parts (up to about 5 each).",
    );
  });

  it("raises one note per remaining condition, in a stable order", () => {
    const notices = runFitNotices({
      ...fits,
      unknownSizeCount: 1,
      contextTruncated: true,
      summaryCoverage: { read: 50, total: 60 },
    });

    expect(notices.map((notice) => notice.tone)).toEqual(["note", "note", "note"]);
    expect(notices[0]!.message).toMatch(/context material/i);
    expect(notices[1]!.message).toBe("The run summary will read the first 50 of 60 records.");
    expect(notices[2]!.message).toMatch(/1 document was uploaded before sizes were recorded/);
  });
});
