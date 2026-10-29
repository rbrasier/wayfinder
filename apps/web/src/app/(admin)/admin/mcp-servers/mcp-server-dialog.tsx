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
  oauthFieldsOf,
  serverFormProblems,
  signInChange,
  signInMethodOf,
  signInProblems,
  type OAuthSettingsView,
  type ServerFormField,
  type ServerFormProblem,
  type SignInFieldValues,
  type SignInMethod,
} from "./mcp-server-model";
import { SignInFields } from "./sign-in-fields";

export interface EditableMcpServer {
  id: string;
  label: string;
  url: string;
  communicatesExternally: boolean;
  hasCredential: boolean;
  credentialRef: string | null;
  oauth: OAuthSettingsView | null;
}

export type McpServerDialogTarget = { mode: "create" } | { mode: "edit"; server: EditableMcpServer };

type Transport = "sse" | "streamable-http";

interface McpServerDialogProps {
  target: McpServerDialogTarget | null;
  onClose: () => void;
  onSaved: () => void;
}

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs";

// Registers a new server or edits an existing one. Secret fields never show what
// is stored: left blank they keep it. Saving a server still on a legacy
// environment variable moves that token into secure storage (UpdateMcpServer).
// Transport is chosen only when registering — an existing server keeps its own.
export function McpServerDialog({ target, onClose, onSaved }: McpServerDialogProps) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<Transport>("sse");
  const [communicatesExternally, setCommunicatesExternally] = useState(false);
  const [signInMethod, setSignInMethod] = useState<SignInMethod>("none");
  const [signInValues, setSignInValues] = useState<SignInFieldValues>({ token: "", oauth: oauthFieldsOf(null) });
  const [problems, setProblems] = useState<ServerFormProblem[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) return;
    const server = target.mode === "edit" ? target.server : null;
    setLabel(server?.label ?? "");
    setUrl(server?.url ?? "");
    setTransport("sse");
    setCommunicatesExternally(server?.communicatesExternally ?? false);
    setSignInMethod(server ? signInMethodOf(server) : "none");
    setSignInValues({ token: "", oauth: oauthFieldsOf(server?.oauth ?? null) });
    setProblems([]);
    setSaveError(null);
  }, [target]);

  const mutationHandlers = {
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (cause: { message: string }) => setSaveError(cause.message),
  };
  const register = trpc.mcpServer.register.useMutation(mutationHandlers);
  const update = trpc.mcpServer.update.useMutation(mutationHandlers);

  if (!target) return null;
  const server = target.mode === "edit" ? target.server : null;
  const currentSignIn = server ? signInMethodOf(server) : "none";
  const isPending = register.isPending || update.isPending;
  const saveLabel = server ? "Save" : "Register server";
  const messagesFor = (field: ServerFormField) =>
    problems.filter((problem) => problem.field === field).map((problem) => problem.message);
  const invalid = (field: ServerFormField) => (messagesFor(field).length > 0 ? true : undefined);
  const describedBy = (field: ServerFormField) => (invalid(field) ? `mcp-dialog-${field}-problem` : undefined);

  const save = () => {
    const found = [
      ...serverFormProblems({ label, url }),
      ...signInProblems(signInMethod, signInValues, currentSignIn),
    ];
    setProblems(found);
    if (found.length > 0) {
      revealFirstProblem(dialogRef.current);
      return;
    }
    const signIn = signInChange(signInMethod, signInValues, currentSignIn);
    const fields = { label: label.trim(), url: url.trim(), communicatesExternally };
    if (!server) {
      register.mutate({ ...fields, transport, credential: signIn.credential ?? null, oauth: signIn.oauth ?? null });
      return;
    }
    update.mutate({ id: server.id, ...fields, ...signIn });
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent ref={dialogRef} aria-describedby="mcp-dialog-description">
        <DialogHeader>
          <DialogTitle>{server ? `Edit ${server.label}` : "New MCP server"}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="max-h-[70vh] overflow-y-auto">
          <DialogDescription id="mcp-dialog-description">
            {server
              ? "Tokens and secrets are stored encrypted and never shown again. Leave them blank to keep the current ones."
              : "Register a remote Model Context Protocol server. Flow authors can then use its tools without seeing credentials. Tokens and secrets are stored encrypted and never shown again."}
          </DialogDescription>
          {saveError ? (
            <p role="alert" className="text-[13px] font-medium text-[#b42318]">
              {saveError}
            </p>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="mcp-dialog-label">Label</Label>
            <FieldProblemText id="mcp-dialog-label-problem" messages={messagesFor("label")} />
            <Input
              id="mcp-dialog-label"
              className={INVALID_OUTLINE}
              aria-invalid={invalid("label")}
              aria-describedby={describedBy("label")}
              value={label}
              placeholder="GitHub"
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          {server ? null : (
            <div className="space-y-1">
              <Label htmlFor="mcp-dialog-transport">Transport</Label>
              <select
                id="mcp-dialog-transport"
                className={SELECT_CLASS}
                value={transport}
                onChange={(event) => setTransport(event.target.value as Transport)}
              >
                <option value="sse">SSE</option>
                <option value="streamable-http">Streamable HTTP</option>
              </select>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="mcp-dialog-url">URL</Label>
            <FieldProblemText id="mcp-dialog-url-problem" messages={messagesFor("url")} />
            <Input
              id="mcp-dialog-url"
              className={INVALID_OUTLINE}
              aria-invalid={invalid("url")}
              aria-describedby={describedBy("url")}
              value={url}
              placeholder="https://mcp.example.com/sse"
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>

          <SignInFields
            idPrefix="mcp-dialog"
            method={signInMethod}
            onMethodChange={setSignInMethod}
            values={signInValues}
            onValuesChange={setSignInValues}
            current={currentSignIn}
            legacyCredentialRef={server?.credentialRef ?? null}
            messagesFor={messagesFor}
          />

          <div className="space-y-1">
            <label htmlFor="mcp-dialog-external" className="flex items-center gap-2 text-[13px] font-medium">
              <input
                id="mcp-dialog-external"
                type="checkbox"
                checked={communicatesExternally}
                onChange={(event) => setCommunicatesExternally(event.target.checked)}
              />
              Sends data outside Wayfinder
            </label>
            <p className="pl-6 text-xs text-muted-foreground">
              Tick for integrations that pass data to another system (ParlView, a ticketing tool); leave off
              for self-contained utilities such as spellcheck. Either way the server can be used in AI task and
              conversational steps — this marks it External so flow authors know where their data goes.
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isPending}>
            {isPending ? "Saving…" : saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
