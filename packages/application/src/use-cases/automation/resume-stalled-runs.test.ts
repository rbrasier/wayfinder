import { describe, expect, it } from "vitest";
import { ok } from "@wayfinder/domain";
import { ResumeStalledRuns } from "./resume-stalled-runs";

describe("ResumeStalledRuns", () => {
  it("resumes each stalled run the repository finds, resume-only, and reports how many", async () => {
    const asked: Array<{ staleBefore: Date; limit: number }> = [];
    const resumed: Array<{ sessionId: string; resumeOnly?: boolean }> = [];
    const useCase = new ResumeStalledRuns({
      runs: {
        listResumableSessionIds: async (staleBefore, limit) => {
          asked.push({ staleBefore, limit });
          return ok(["session-1", "session-2"]);
        },
      },
      resume: (input) => {
        resumed.push(input);
      },
      now: () => new Date("2026-10-22T00:10:00.000Z"),
    });

    const result = await useCase.execute({ staleAfterMs: 60_000, limit: 20 });

    expect(result.data).toEqual({ resumed: 2 });
    expect(asked).toEqual([{ staleBefore: new Date("2026-10-22T00:09:00.000Z"), limit: 20 }]);
    expect(resumed).toEqual([
      { sessionId: "session-1", resumeOnly: true },
      { sessionId: "session-2", resumeOnly: true },
    ]);
  });
});
