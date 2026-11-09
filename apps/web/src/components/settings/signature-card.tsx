"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ConnectivityResult, SignatureMethod } from "@wayfinder/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";
import { ConnectivityTest, type ConnectivityController } from "./connectivity";

const METHOD_OPTIONS: ReadonlyArray<{ value: SignatureMethod; label: string; description: string }> = [
  {
    value: "attestation",
    label: "Attestation only",
    description: "The approval block (name, decision, date, verification code). No extra services.",
  },
  {
    value: "drawn",
    label: "Drawn signature",
    description:
      "Approvers draw their signature once; it is placed above the approval block. A simple electronic signature, not a digital one.",
  },
  {
    value: "certificate",
    label: "Digital certificate",
    description:
      "Approvers sign with their digital ID through a remote signing provider. Produces a signed PDF anyone can verify in Acrobat.",
  },
];

const TARGET_LABELS: Record<string, string> = {
  "pdf-converter": "PDF converter",
  "signature-engine": "Signature engine",
  "timestamp-authority": "Timestamp authority",
  "signing-provider": "Signing provider",
};

interface FormState {
  method: SignatureMethod;
  gotenbergUrl: string;
  dssUrl: string;
  tsaUrl: string;
  cscBaseUrl: string;
  cscClientId: string;
  cscClientSecret: string;
  hasClientSecret: boolean;
}

const EMPTY_FORM: FormState = {
  method: "attestation",
  gotenbergUrl: "",
  dssUrl: "",
  tsaUrl: "",
  cscBaseUrl: "",
  cscClientId: "",
  cscClientSecret: "",
  hasClientSecret: false,
};

const toInput = (form: FormState) => ({
  method: form.method,
  gotenbergUrl: form.gotenbergUrl,
  dssUrl: form.dssUrl,
  tsaUrl: form.tsaUrl,
  csc:
    form.cscBaseUrl.trim() && form.cscClientId.trim()
      ? { baseUrl: form.cscBaseUrl, clientId: form.cscClientId, clientSecret: form.cscClientSecret }
      : null,
});

const methodLabel = (method: SignatureMethod): string =>
  METHOD_OPTIONS.find((option) => option.value === method)?.label ?? method;

function UrlField(props: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  help: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">{props.help}</p>
    </div>
  );
}

function TestResults({ results }: { results: ConnectivityResult[] | null }) {
  if (!results) return null;
  if (results.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing to test for this method.</p>;
  }
  return (
    <ul className="space-y-1 text-sm" data-testid="signature-test-results">
      {results.map((result) => (
        <li key={result.target} className="flex justify-between gap-4">
          <span>{TARGET_LABELS[result.target] ?? result.target}</span>
          <span className={result.ok ? "text-emerald-700" : "text-destructive"}>
            {result.ok ? "OK" : (result.message ?? "Failed")}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Install-wide document signatures (ADR-067): how a claimed signature slot is
// signed, and the services that needs. Saving runs the same live Test, so a
// method can never be enabled with its services broken.
export function SignatureCard({ connectivity }: { connectivity: ConnectivityController }) {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getSignature.useQuery();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [testResults, setTestResults] = useState<ConnectivityResult[] | null>(null);
  const config = configQuery.data;

  const testMutation = trpc.settings.testSignature.useMutation({
    onSuccess: (results) => setTestResults(results),
    onError: (error) => toast.error(error.message ?? "Test failed"),
  });
  const saveMutation = trpc.settings.setSignature.useMutation({
    onSuccess: async () => {
      toast.success("Signature settings saved");
      await utils.settings.getSignature.invalidate();
      await utils.settings.getSignatureCapabilities.invalidate();
      setOpen(false);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save signature settings"),
  });

  useEffect(() => {
    if (!open || !config) return;
    setTestResults(null);
    setForm({
      method: config.method,
      gotenbergUrl: config.gotenbergUrl ?? "",
      dssUrl: config.dssUrl ?? "",
      tsaUrl: config.tsaUrl ?? "",
      cscBaseUrl: config.csc?.baseUrl ?? "",
      cscClientId: config.csc?.clientId ?? "",
      cscClientSecret: "",
      hasClientSecret: config.csc?.hasClientSecret ?? false,
    });
  }, [open, config]);

  const update = (patch: Partial<FormState>) => {
    setTestResults(null);
    setForm((current) => ({ ...current, ...patch }));
  };
  const isCertificate = form.method === "certificate";

  return (
    <Card data-testid="signature-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">PDF signatures</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!config}>
          Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          How approvers sign the signature slots in your templates, and whether signed documents become PDFs.
        </p>
        {!config ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Signature method</span>
              <span className="text-right font-medium" data-testid="signature-method">
                {methodLabel(config.method)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">PDF converter</span>
              <span className="text-right font-medium">{config.gotenbergUrl ?? "Not configured"}</span>
            </div>
            {config.method === "certificate" && (
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Signing provider</span>
                <span className="text-right font-medium">{config.csc?.baseUrl ?? "Not configured"}</span>
              </div>
            )}
            {config.gotenbergUrl && (
              <ConnectivityTest target="pdf-converter" controller={connectivity} label="PDF converter" />
            )}
            {config.method === "certificate" && (
              <>
                <ConnectivityTest target="signature-engine" controller={connectivity} label="signature engine" />
                <ConnectivityTest target="timestamp-authority" controller={connectivity} label="timestamp authority" />
                <ConnectivityTest target="signing-provider" controller={connectivity} label="signing provider" />
              </>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && setOpen(false)}>
        {/* Capped to the screen with only the body scrolling: the certificate
            fields push the form past a laptop screen, and the Test and Save
            buttons must stay reachable. */}
        <DialogContent className="flex max-h-[90vh] max-w-xl flex-col">
          <DialogHeader>
            <DialogTitle>PDF signatures</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="min-h-0 flex-1 space-y-5 overflow-y-auto">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Signature method</legend>
              {METHOD_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-start gap-2 text-sm">
                  <input
                    id={`signature-method-${option.value}`}
                    type="radio"
                    name="signature-method"
                    className="mt-1"
                    data-testid={`signature-method-${option.value}`}
                    checked={form.method === option.value}
                    onChange={() => update({ method: option.value })}
                  />
                  <div>
                    <Label htmlFor={`signature-method-${option.value}`} className="font-medium">
                      {option.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  </div>
                </div>
              ))}
            </fieldset>

            <UrlField
              id="signature-gotenberg-url"
              label="PDF converter URL"
              value={form.gotenbergUrl}
              placeholder="http://gotenberg:3000"
              help={
                isCertificate
                  ? "Required. The Gotenberg sidecar that turns documents into PDF/A."
                  : "Optional. Needed for approval steps set to Convert to PDF on signing."
              }
              onChange={(value) => update({ gotenbergUrl: value })}
            />

            {isCertificate && (
              <>
                <UrlField
                  id="signature-dss-url"
                  label="Signature engine (DSS) URL"
                  value={form.dssUrl}
                  placeholder="http://dss:8080"
                  help="The DSS sidecar that builds and validates PAdES signatures. Trust anchors are set where it is deployed, not here."
                  onChange={(value) => update({ dssUrl: value })}
                />
                <UrlField
                  id="signature-tsa-url"
                  label="Timestamp authority URL"
                  value={form.tsaUrl}
                  placeholder="https://timestamp.example.com/tsr"
                  help="An RFC 3161 timestamp service. Keeps signatures verifiable after the signer's certificate expires."
                  onChange={(value) => update({ tsaUrl: value })}
                />
                <UrlField
                  id="signature-csc-url"
                  label="Signing provider (CSC API) URL"
                  value={form.cscBaseUrl}
                  placeholder="https://provider.example.com/csc/v2"
                  help="The remote signing service approvers authorise their signature with."
                  onChange={(value) => update({ cscBaseUrl: value })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="signature-csc-client-id">Client ID</Label>
                    <Input
                      id="signature-csc-client-id"
                      value={form.cscClientId}
                      onChange={(event) => update({ cscClientId: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="signature-csc-client-secret">Client secret</Label>
                    <Input
                      id="signature-csc-client-secret"
                      type="password"
                      value={form.cscClientSecret}
                      placeholder={form.hasClientSecret ? "Saved — leave blank to keep" : ""}
                      onChange={(event) => update({ cscClientSecret: event.target.value })}
                    />
                  </div>
                </div>
              </>
            )}

            <TestResults results={testResults} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              data-testid="signature-test"
              onClick={() => testMutation.mutate(toInput(form))}
              disabled={testMutation.isPending}
            >
              {testMutation.isPending ? "Testing…" : "Test"}
            </Button>
            <Button
              data-testid="signature-save"
              onClick={() => saveMutation.mutate(toInput(form))}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
