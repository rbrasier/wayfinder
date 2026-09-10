"use client";

import type { FlowImportInspection } from "@wayfinder/domain";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { FlowImportInspectionPanel } from "./flow-import-inspection-panel";

interface FlowImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: (flowId: string) => void;
}

type Stage = "choosing" | "inspecting" | "inspected" | "committing";

const readError = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? "The archive could not be read.";
};

// Inspect-then-commit (ADR-049 §5). The file stays on the client between the two
// posts, so nothing half-imported is ever parked server-side waiting for the
// user to decide.
export function FlowImportDialog({ open, onClose, onImported }: FlowImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<FlowImportInspection | null>(null);
  const [stage, setStage] = useState<Stage>("choosing");
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setFile(null);
    setInspection(null);
    setStage("choosing");
    setError(null);
  };

  const close = (): void => {
    reset();
    onClose();
  };

  const post = async (chosen: File, mode: "inspect" | "commit"): Promise<Response> => {
    const body = new FormData();
    body.set("file", chosen);
    body.set("mode", mode);
    return fetch("/api/flows/import", { method: "POST", body });
  };

  const inspect = async (chosen: File): Promise<void> => {
    setFile(chosen);
    setStage("inspecting");
    setError(null);

    const response = await post(chosen, "inspect");
    if (!response.ok) {
      setError(await readError(response));
      setStage("choosing");
      return;
    }

    setInspection((await response.json()) as FlowImportInspection);
    setStage("inspected");
  };

  const commit = async (): Promise<void> => {
    if (!file) return;
    setStage("committing");
    setError(null);

    const response = await post(file, "commit");
    if (!response.ok) {
      setError(await readError(response));
      setStage("inspected");
      return;
    }

    const body = (await response.json()) as { flowId: string };
    reset();
    onImported(body.flowId);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import a flow</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>

        <DialogBody>
          {stage === "choosing" ? (
            <div className="space-y-3">
              <p className="text-sm text-[#5c574c]">
                Choose a flow archive (<code>.zip</code>). You will see what it contains before
                anything is created.
              </p>
              <input
                type="file"
                accept=".zip,application/zip"
                aria-label="Flow archive"
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  if (chosen) void inspect(chosen);
                }}
              />
            </div>
          ) : null}

          {stage === "inspecting" ? (
            <div className="flex items-center gap-2 text-sm" role="status">
              <Spinner /> Reading the archive…
            </div>
          ) : null}

          {inspection && (stage === "inspected" || stage === "committing") ? (
            <FlowImportInspectionPanel inspection={inspection} />
          ) : null}

          {error ? (
            <p className="mt-4 text-sm text-[#a8324c]" role="alert">
              {error}
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={stage === "committing"}>
            Cancel
          </Button>
          <Button
            onClick={() => void commit()}
            disabled={stage !== "inspected"}
            data-testid="confirm-flow-import"
          >
            {stage === "committing" ? "Importing…" : "Import as draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
