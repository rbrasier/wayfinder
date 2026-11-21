"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ConnectivityResult, EngineSource, SignatureMethod } from "@wayfinder/domain";
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
import {
  EMPTY_FORM,
  engineStatusLabel,
  formFromConfig,
  inputFromForm,
  testTargetLabel,
  type FormState,
} from "./signature-card-model";

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

const methodLabel = (method: SignatureMethod): string =>
  METHOD_OPTIONS.find((option) => option.value === method)?.label ?? method;

function SummaryRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

// Built-in or External for one engine (ADR-069 §2). The URL only matters for
// External, so it only appears then.
function EngineField(props: {
  id: string;
  label: string;
  source: EngineSource;
  url: string;
  placeholder: string;
  builtInHelp: string;
  externalHelp: string;
  onSourceChange: (source: EngineSource) => void;
  onUrlChange: (url: string) => void;
}) {
  return (
    <fieldset className="space-y-2" data-testid={`${props.id}-field`}>
      <legend className="text-sm font-medium">{props.label}</legend>
      <div className="flex gap-4 text-sm">
        {(["built-in", "external"] as const).map((source) => (
          <label key={source} className="flex items-center gap-2">
            <input
              type="radio"
              name={`${props.id}-source`}
              data-testid={`${props.id}-${source}`}
              checked={props.source === source}
              onChange={() => props.onSourceChange(source)}
            />
            {source === "built-in" ? "Built-in" : "External"}
          </label>
        ))}
      </div>
      {props.source === "external" ? (
        <Input
          id={`${props.id}-url`}
          aria-label={`${props.label} URL`}
          value={props.url}
          placeholder={props.placeholder}
          onChange={(event) => props.onUrlChange(event.target.value)}
        />
      ) : null}
      <p className="text-xs text-muted-foreground">
        {props.source === "external" ? props.externalHelp : props.builtInHelp}
      </p>
    </fieldset>
  );
}

function TestResults({ results, form }: { results: ConnectivityResult[] | null; form: FormState }) {
  if (!results) return null;
  if (results.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing to test for this method.</p>;
  }
  return (
    <ul className="space-y-1 text-sm" data-testid="signature-test-results">
      {results.map((result) => (
        <li key={result.target} className="flex justify-between gap-4">
          <span>{testTargetLabel(result.target, form)}</span>
          <span className={result.ok ? "text-emerald-700" : "text-destructive"}>
            {result.ok ? "OK" : (result.message ?? "Failed")}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Install-wide document signatures (ADR-067): how a claimed signature slot is
// signed, and the engines that needs — built into this image or deployed
// separately (ADR-069). Saving runs the same live Test, so a method can never
// be enabled with its engines broken.
export function SignatureCard({ connectivity }: { connectivity: ConnectivityController }) {
  const utils = trpc.useUtils();
  const configQuery = trpc.settings.getSignature.useQuery();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [testResults, setTestResults] = useState<ConnectivityResult[] | null>(null);
  const config = configQuery.data;

  const testMutation = trpc.settings.testSignature.useMutation({
    onSuccess: async (results) => {
      setTestResults(results);
      await utils.settings.getSignature.invalidate();
    },
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

  // Filled once per opening. The query refetches while the dialog is open (a
  // Test refreshes the engines' status), and refilling then would throw away
  // the admin's unsaved edits along with the Test results.
  const filledForThisOpening = useRef(false);
  useEffect(() => {
    if (!open) {
      filledForThisOpening.current = false;
      return;
    }
    if (!config || filledForThisOpening.current) return;
    filledForThisOpening.current = true;
    setTestResults(null);
    setForm(formFromConfig(config));
  }, [open, config]);

  const update = (patch: Partial<FormState>) => {
    setTestResults(null);
    setForm((current) => ({ ...current, ...patch }));
  };
  const isCertificate = form.method === "certificate";
  const converterUsable =
    config && (config.pdfConverter.source === "external" || config.builtInStatus.pdfConverter !== "unavailable");

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
            <SummaryRow label="Signature method" value={methodLabel(config.method)} testId="signature-method" />
            <SummaryRow
              label="PDF converter"
              value={engineStatusLabel(config.pdfConverter, config.builtInStatus.pdfConverter)}
              testId="signature-pdf-converter-status"
            />
            {config.method === "certificate" && (
              <>
                <SummaryRow
                  label="Signature engine"
                  value={engineStatusLabel(config.signatureEngine, config.builtInStatus.signatureEngine)}
                  testId="signature-engine-status"
                />
                <SummaryRow label="Timestamp authority" value={config.tsaUrl ?? "DigiCert (default)"} />
                <SummaryRow label="Signing provider" value={config.csc?.baseUrl ?? "Not configured"} />
              </>
            )}
            {converterUsable && (
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

            <EngineField
              id="signature-pdf-converter"
              label="PDF converter"
              source={form.pdfConverterSource}
              url={form.pdfConverterUrl}
              placeholder="http://gotenberg:3000"
              builtInHelp="Converts documents to PDF/A with the LibreOffice inside this Wayfinder image. Nothing else to deploy."
              externalHelp="A Gotenberg service you run yourself."
              onSourceChange={(source) => update({ pdfConverterSource: source })}
              onUrlChange={(url) => update({ pdfConverterUrl: url })}
            />

            {isCertificate && (
              <>
                <EngineField
                  id="signature-engine"
                  label="Signature engine"
                  source={form.signatureEngineSource}
                  url={form.signatureEngineUrl}
                  placeholder="http://dss:8080"
                  builtInHelp="Builds and checks digital signatures with the EU DSS engine inside this Wayfinder image. It starts when first needed."
                  externalHelp="A DSS sidecar you run yourself. Trust anchors are set where it is deployed, not here."
                  onSourceChange={(source) => update({ signatureEngineSource: source })}
                  onUrlChange={(url) => update({ signatureEngineUrl: url })}
                />
                <div className="space-y-1">
                  <Label htmlFor="signature-csc-url">Signing provider (CSC API) URL</Label>
                  <Input
                    id="signature-csc-url"
                    value={form.cscBaseUrl}
                    placeholder="https://provider.example.com/csc/v2"
                    onChange={(event) => update({ cscBaseUrl: event.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    The remote signing service approvers authorise their signature with.
                  </p>
                </div>
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
                {/* A timestamp authority is a third party by design, so it is
                    never built in; most installs never need to change it. */}
                <details className="rounded-md border px-3 py-2" data-testid="signature-advanced">
                  <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
                  <div className="mt-3 space-y-1">
                    <Label htmlFor="signature-tsa-url">Timestamp authority URL</Label>
                    <Input
                      id="signature-tsa-url"
                      value={form.tsaUrl}
                      placeholder="DigiCert (default)"
                      onChange={(event) => update({ tsaUrl: event.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      An independent RFC 3161 service that vouches for when each signature was made, so it stays
                      verifiable after the signer&apos;s certificate expires. Leave blank to use DigiCert&apos;s free
                      service; air-gapped installs set their organisation&apos;s own.
                    </p>
                  </div>
                </details>
              </>
            )}

            <TestResults results={testResults} form={form} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              data-testid="signature-test"
              onClick={() => testMutation.mutate(inputFromForm(form))}
              disabled={testMutation.isPending}
            >
              {testMutation.isPending ? "Testing…" : "Test"}
            </Button>
            <Button
              data-testid="signature-save"
              onClick={() => saveMutation.mutate(inputFromForm(form))}
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
