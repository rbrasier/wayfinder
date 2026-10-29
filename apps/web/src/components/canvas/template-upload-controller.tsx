"use client";

import { useReducer, type ChangeEvent, type RefObject } from "react";
import { rowsFromDocumentTags } from "@/lib/template-annotation";
import { TemplateAnnotationModal } from "./template-annotation-modal";
import { TemplateDraftModal } from "./template-draft-modal";
import { TemplateSourceChoiceModal } from "./template-source-choice-modal";
import {
  initialUploadFlow,
  isUploadFlowOpen,
  uploadFlowReducer,
  type UploadStage,
} from "./template-upload-flow-model";

export interface TemplateUploadResult {
  path: string;
  filename: string;
  documentTemplateContent: string | null;
  documentTemplateFormat?: "docx" | "xlsx";
  spreadsheetTemplateMode?: "tags" | "header" | null;
}

// The node-config fields a saved template writes back.
export const templateValuesFrom = (result: TemplateUploadResult) => ({
  documentTemplatePath: result.path,
  documentTemplateFilename: result.filename,
  documentTemplateContent: result.documentTemplateContent ?? null,
  documentTemplateFormat: (result.documentTemplateFormat ?? "docx") as "docx" | "xlsx",
  spreadsheetTemplateMode: result.spreadsheetTemplateMode ?? null,
});

export interface TemplateUploadController {
  stage: UploadStage;
  pendingFile: File | null;
  editingFields: boolean;
  isOpen: boolean;
  // Opens the choice between a tagged template and a filled example.
  start: () => void;
  chooseTagged: () => void;
  chooseExamples: () => void;
  // A draft the author downloaded, finished in Word and uploaded again.
  switchToTagged: (file: File) => void;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  editFields: () => void;
  reset: () => void;
  complete: (result: TemplateUploadResult) => void;
}

// Owns the handoff from the node-config upload button to the modals. Upload now
// opens a choice: a tagged template goes through the file picker into the guided
// annotation modal as before; a filled example opens the drafting modal
// (ADR-066). Nothing is persisted until a modal saves the reviewed result.
export function useTemplateUpload(
  fileInputRef: RefObject<HTMLInputElement | null>,
  onApply: (result: TemplateUploadResult) => void,
): TemplateUploadController {
  const [state, dispatch] = useReducer(uploadFlowReducer, initialUploadFlow);

  const reset = () => dispatch({ type: "reset" });

  return {
    stage: state.stage,
    pendingFile: state.pendingFile,
    editingFields: state.editingFields,
    isOpen: isUploadFlowOpen(state),
    start: () => dispatch({ type: "start" }),
    chooseTagged: () => {
      dispatch({ type: "choose-tagged" });
      fileInputRef.current?.click();
    },
    chooseExamples: () => dispatch({ type: "choose-examples" }),
    switchToTagged: (file) => dispatch({ type: "switch-to-tagged", file }),
    handleFileChange: (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      dispatch({ type: "file-picked", file });
      // Cleared so re-picking the same file still fires a change event.
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    editFields: () => dispatch({ type: "edit-fields" }),
    reset,
    complete: (result) => {
      onApply(result);
      reset();
    },
  };
}

export function TemplateAnnotationHost({
  controller,
  flowId,
  nodeId,
  documentTemplateContent,
}: {
  controller: TemplateUploadController;
  flowId: string;
  nodeId: string | null;
  documentTemplateContent: string | null | undefined;
}) {
  if (!nodeId || !controller.isOpen) return null;

  if (controller.stage === "choosing") {
    return (
      <TemplateSourceChoiceModal
        onChooseTagged={controller.chooseTagged}
        onChooseExamples={controller.chooseExamples}
        onCancel={controller.reset}
      />
    );
  }

  if (controller.stage === "examples") {
    return (
      <TemplateDraftModal
        flowId={flowId}
        nodeId={nodeId}
        onCancel={controller.reset}
        onSaved={controller.complete}
        onSwitchToTagged={controller.switchToTagged}
      />
    );
  }

  return (
    <TemplateAnnotationModal
      file={controller.pendingFile}
      flowId={flowId}
      nodeId={nodeId}
      // Re-entry reads the field set back out of the stored template's text, so
      // editing fields never requires another trip through the file picker.
      existingRows={
        controller.editingFields ? rowsFromDocumentTags(documentTemplateContent ?? "") : null
      }
      onCancel={controller.reset}
      onSaved={controller.complete}
    />
  );
}
