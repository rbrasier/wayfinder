import { describe, expect, it } from "vitest";
import { runStatusLabel, runStatusTone } from "./run-status";

describe("run status presentation", () => {
  it("names every status in the words run history shows", () => {
    expect(runStatusLabel("running")).toBe("Running");
    expect(runStatusLabel("waiting_on_person")).toBe("Waiting on a person");
    expect(runStatusLabel("failed")).toBe("Failed");
    expect(runStatusLabel("completed")).toBe("Completed");
    expect(runStatusLabel("cancelled")).toBe("Cancelled");
    expect(runStatusLabel("abandoned")).toBe("Abandoned");
  });

  it("flags failures and hand-offs so they stand out from finished runs", () => {
    expect(runStatusTone("failed")).toBe("danger");
    expect(runStatusTone("waiting_on_person")).toBe("attention");
    expect(runStatusTone("completed")).toBe("neutral");
  });
});
