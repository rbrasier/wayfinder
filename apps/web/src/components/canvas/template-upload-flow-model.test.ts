import { describe, expect, it } from "vitest";
import { initialUploadFlow, isUploadFlowOpen, uploadFlowReducer, type UploadFlowState } from "./template-upload-flow-model";

const file = new File(["x"], "contract.docx");

const run = (...actions: Parameters<typeof uploadFlowReducer>[1][]): UploadFlowState =>
  actions.reduce(uploadFlowReducer, initialUploadFlow);

describe("uploadFlowReducer", () => {
  it("starts closed", () => {
    expect(isUploadFlowOpen(initialUploadFlow)).toBe(false);
  });

  it("opens the choice between a tagged template and an example", () => {
    const state = run({ type: "start" });
    expect(state.stage).toBe("choosing");
    expect(isUploadFlowOpen(state)).toBe(true);
  });

  it("closes the choice when the author has a tagged template, ready for the file picker", () => {
    const state = run({ type: "start" }, { type: "choose-tagged" });
    expect(state.stage).toBe("idle");
    expect(isUploadFlowOpen(state)).toBe(false);
  });

  it("hands a picked tagged template to the existing annotation flow, unchanged", () => {
    const state = run({ type: "start" }, { type: "choose-tagged" }, { type: "file-picked", file });
    expect(state).toEqual({ stage: "idle", pendingFile: file, editingFields: false });
    expect(isUploadFlowOpen(state)).toBe(true);
  });

  it("opens the example path", () => {
    expect(run({ type: "start" }, { type: "choose-examples" }).stage).toBe("examples");
  });

  it("moves a downloaded draft the author re-uploads onto the tagged-template path", () => {
    const state = run({ type: "start" }, { type: "choose-examples" }, { type: "switch-to-tagged", file });
    expect(state).toEqual({ stage: "idle", pendingFile: file, editingFields: false });
  });

  it("opens field editing for an attached template without the choice", () => {
    expect(run({ type: "edit-fields" })).toEqual({ stage: "idle", pendingFile: null, editingFields: true });
  });

  it("resets from anywhere", () => {
    expect(run({ type: "start" }, { type: "choose-examples" }, { type: "reset" })).toEqual(initialUploadFlow);
  });
});
