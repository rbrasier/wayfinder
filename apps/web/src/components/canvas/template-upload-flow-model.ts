// Which template-upload surface is open. `choosing` is the two-button choice;
// `examples` is the draft-from-examples path (ADR-067). A picked or re-uploaded
// file, or field editing, opens the existing tagged-template annotation flow.
export type UploadStage = "idle" | "choosing" | "examples";

export interface UploadFlowState {
  stage: UploadStage;
  pendingFile: File | null;
  editingFields: boolean;
}

export type UploadFlowAction =
  | { type: "start" }
  | { type: "choose-tagged" }
  | { type: "choose-examples" }
  | { type: "file-picked"; file: File }
  | { type: "switch-to-tagged"; file: File }
  | { type: "edit-fields" }
  | { type: "reset" };

export const initialUploadFlow: UploadFlowState = { stage: "idle", pendingFile: null, editingFields: false };

export const uploadFlowReducer = (state: UploadFlowState, action: UploadFlowAction): UploadFlowState => {
  switch (action.type) {
    case "start":
      return { ...initialUploadFlow, stage: "choosing" };
    case "choose-tagged":
      return initialUploadFlow;
    case "choose-examples":
      return { ...initialUploadFlow, stage: "examples" };
    case "file-picked":
    case "switch-to-tagged":
      return { stage: "idle", pendingFile: action.file, editingFields: false };
    case "edit-fields":
      return { ...initialUploadFlow, editingFields: true };
    case "reset":
      return initialUploadFlow;
  }
};

export const isUploadFlowOpen = (state: UploadFlowState): boolean =>
  state.stage !== "idle" || state.pendingFile !== null || state.editingFields;
