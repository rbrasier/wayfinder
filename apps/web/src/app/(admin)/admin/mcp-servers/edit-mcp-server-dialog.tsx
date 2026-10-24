"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldProblemText, INVALID_OUTLINE, revealFirstProblem } from "@/components/ui/field-problem";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";
import {
  credentialChange,
  credentialSummary,
  serverFormProblems,
  type ServerFormField,
  type ServerFormProblem,
} from "./mcp-server-model";

export interface EditableMcpServer {
  id: string;
  label: string;
  url: string;
  communicatesExternally: boolean;
  hasCredential: boolean;
  credentialRef: string | null;
}

interface EditMcpServerDialogProps {
  server: EditableMcpServer | null;
  onClose: () => void;
  onSaved: () => void;
}

// Edits a registered server. The token field never shows the stored token: left
// blank it keeps it. Saving a server still on a legacy environment variable
// moves that token into secure storage (UpdateMcpServer).
export function EditMcpServerDialog({ server, onClose, onSaved }: EditMcpServerDialogProps) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [communicatesExternally, setCommunicatesExternally] = useState(false);
  const [token, setToken] = useState("");
  const [removeToken, setRemoveToken] = useState(false);
  const [problems, setProblems] = useState<ServerFormProblem[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!server) return;
    setLabel(server.label);
    setUrl(server.url);
    setCommunicatesExternally(server.communicatesExternally);
    setToken("");
    setRemoveToken(false);
    setProblems([]);
    setSaveError(null);
  }, [server]);

  const update = trpc.mcpServer.update.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (cause) => setSaveError(cause.message),
  });

  if (!server) return null;
  const summary = credentialSummary(server);
  const messagesFor = (field: ServerFormField) =>
    problems.filter((problem) => problem.field === field).map((problem) => problem.message);
  const invalid = (field: ServerFormField) => (messagesFor(field).length > 0 ? true : undefined);
  const describedBy = (field: ServerFormField) => (invalid(field) ? `mcp-edit-${field}-problem` : undefined);

  const save = () => {
    const found = serverFormProblems({ label, url });
    setProblems(found);
    if (found.length > 0) {
      revealFirstProblem(dialogRef.current);
      return;
    }
    update.mutate({
      id: server.id,
      label: label.trim(),
      url: url.trim(),
      communicatesExternally,
      credential: credentialChange({ token, remove: removeToken }),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent ref={dialogRef} aria-describedby="mcp-edit-description">
        <DialogHeader>
          <DialogTitle>Edit {server.label}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <DialogDescription id="mcp-edit-description">
            The token is stored encrypted and never shown again. Leave it blank to keep the
            current one.
          </DialogDescription>
          {saveError ? (
            <p role="alert" className="text-[13px] font-medium text-[#b42318]">
              {saveError}
            </p>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="mcp-edit-label">Label</Label>
            <FieldProblemText id="mcp-edit-label-problem" messages={messagesFor("label")} />
            <Input
              id="mcp-edit-label"
              className={INVALID_OUTLINE}
              aria-invalid={invalid("label")}
              aria-describedby={describedBy("label")}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="mcp-edit-url">URL</Label>
            <FieldProblemText id="mcp-edit-url-problem" messages={messagesFor("url")} />
            <Input
              id="mcp-edit-url"
              className={INVALID_OUTLINE}
              aria-invalid={invalid("url")}
              aria-describedby={describedBy("url")}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="mcp-edit-token">Bearer token</Label>
            {summary.kind === "legacy" ? (
              <p className="text-[12px] text-[#736d5f]">
                Uses the environment variable <code>{server.credentialRef}</code>. Saving moves its
                token into secure storage, or type a new one here.
              </p>
            ) : null}
            <Input
              id="mcp-edit-token"
              type="password"
              autoComplete="off"
              value={token}
              disabled={removeToken}
              onChange={(event) => setToken(event.target.value)}
              placeholder={summary.kind === "stored" ? "A token is stored. Leave blank to keep it" : "Optional"}
            />
            {summary.kind !== "none" ? (
              <label htmlFor="mcp-edit-remove-token" className="flex items-center gap-2 text-[13px]">
                <input
                  id="mcp-edit-remove-token"
                  type="checkbox"
                  checked={removeToken}
                  onChange={(event) => setRemoveToken(event.target.checked)}
                />
                Remove token
              </label>
            ) : null}
          </div>

          <label htmlFor="mcp-edit-external" className="flex items-center gap-2 text-[13px] font-medium">
            <input
              id="mcp-edit-external"
              type="checkbox"
              checked={communicatesExternally}
              onChange={(event) => setCommunicatesExternally(event.target.checked)}
            />
            Sends data outside Wayfinder
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
