import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNATURE_CONFIG, DEFAULT_TSA_URL } from "@wayfinder/domain";
import { StartCertificateSigning } from "./start-certificate-signing";
import { CompleteCertificateSigning } from "./complete-certificate-signing";
import { CERTIFICATE_CONFIG, passedCheck, passedReport, seed, sha256Hex } from "./__fixtures__/certificate-signing-doubles";

const REDIRECT = "http://app/api/signing/csc/callback";

const stateFrom = (url: string) => new URL(url).searchParams.get("state")!;

const startAndReturnState = async (context: Awaited<ReturnType<typeof seed>>) => {
  const started = await new StartCertificateSigning(context.deps).execute({
    approvalId: context.approvalId,
    userId: "manager-1",
    impersonatorId: null,
    comment: "Within delegated authority.",
    redirectUri: REDIRECT,
  });
  return stateFrom(started.data!.redirectUrl);
};

describe("StartCertificateSigning", () => {
  it("sends the approver to the provider for a service token and records the attempt", async () => {
    const context = await seed();

    const result = await new StartCertificateSigning(context.deps).execute({
      approvalId: context.approvalId,
      userId: "manager-1",
      impersonatorId: null,
      comment: "Within delegated authority.",
      redirectUri: REDIRECT,
    });

    expect(result.data!.redirectUrl).toContain("scope=service");
    const state = stateFrom(result.data!.redirectUrl);
    expect(state.startsWith(`${context.approvalId}.`)).toBe(true);
    const record = context.approvals.rows.get(context.approvalId)!.digitalSignature!;
    expect(record.status).toBe("pending");
    expect(record.pending).toMatchObject({
      stage: "service",
      stateHash: sha256Hex(state),
      startedByUserId: "manager-1",
      comment: "Within delegated authority.",
      slotKey: "delegate_signature",
      subjectNodeId: "node-draft",
      signerName: "Jane Doe",
    });
  });

  it("refuses anyone but the assigned approver", async () => {
    const context = await seed();

    const result = await new StartCertificateSigning(context.deps).execute({
      approvalId: context.approvalId,
      userId: "someone-else",
      impersonatorId: null,
      comment: null,
      redirectUri: REDIRECT,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("refuses while an admin is viewing as the approver", async () => {
    const context = await seed();

    const result = await new StartCertificateSigning(context.deps).execute({
      approvalId: context.approvalId,
      userId: "manager-1",
      impersonatorId: "admin-1",
      comment: null,
      redirectUri: REDIRECT,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("refuses when the install does not sign with certificates", async () => {
    const context = await seed();
    context.setConfig({ ...DEFAULT_SIGNATURE_CONFIG });

    const result = await new StartCertificateSigning(context.deps).execute({
      approvalId: context.approvalId,
      userId: "manager-1",
      impersonatorId: null,
      comment: null,
      redirectUri: REDIRECT,
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("CompleteCertificateSigning — service leg", () => {
  it("freezes the document, prepares the signature and asks the signer to authorise its hash", async () => {
    const context = await seed();
    const state = await startAndReturnState(context);

    const result = await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "service-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(result.data).toMatchObject({ outcome: "authorise" });
    if (result.data?.outcome !== "authorise") throw new Error("expected authorise");
    expect(result.data.redirectUrl).toContain("scope=credential");
    expect(result.data.redirectUrl).toContain("hash=ZGlnZXN0");
    const document = context.messages.rows[0]!.document!;
    expect(document.pdf).toMatchObject({ status: "frozen", sha256: "sha-11" });
    expect(document.pdf!.slotAnchors).toEqual({ delegate_signature: { page: 1, x: 72, y: 500 } });
    expect(context.engine.prepared[0]).toMatchObject({
      signingTime: "2026-11-08T10:00:00.000Z",
      // Lifted a few points so the opaque box covers the marker's ascenders.
      appearance: { page: 1, x: 72, y: 497 },
    });
    const pending = context.approvals.rows.get(context.approvalId)!.digitalSignature!.pending!;
    expect(pending).toMatchObject({ stage: "credential", credentialId: "valid", dataToSignDigest: "ZGlnZXN0" });
  });

  it("refuses a certificate the engine finds revoked, before anything is signed", async () => {
    const context = await seed();
    context.engine.check = { ...passedCheck, revoked: true, indication: "INDETERMINATE", subIndication: "REVOKED_NO_POE" };
    const state = await startAndReturnState(context);

    const result = await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "service-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(result.data).toEqual({ outcome: "rejected", approvalId: context.approvalId, reason: "revoked" });
    const approval = context.approvals.rows.get(context.approvalId)!;
    expect(approval.status).toBe("pending");
    expect(approval.digitalSignature).toMatchObject({ status: "rejected", rejection: { reason: "revoked" } });
    expect(context.audit.entries.map((entry) => entry.action)).toContain("signature.rejected");
  });

  it("releases the freeze when the first signature is refused, so the document stays editable", async () => {
    const context = await seed();
    context.engine.check = { ...passedCheck, revoked: true, indication: "INDETERMINATE", subIndication: "REVOKED_NO_POE" };
    const state = await startAndReturnState(context);

    await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "service-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(context.messages.rows[0]!.document!.pdf).toBeUndefined();
  });

  it("fails closed when the provider cannot be reached, leaving the approval pending", async () => {
    const context = await seed();
    const state = await startAndReturnState(context);

    const result = await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "bad",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(result.data).toMatchObject({ outcome: "rejected", reason: "unavailable" });
    expect(context.approvals.rows.get(context.approvalId)!.status).toBe("pending");
    expect(context.decisions).toEqual([]);
  });

  it("refuses a state that does not match the attempt in flight", async () => {
    const context = await seed();
    await startAndReturnState(context);

    const result = await new CompleteCertificateSigning(context.deps).execute({
      state: `${context.approvalId}.forged`,
      code: "service-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("refuses a callback completed by someone other than who started it", async () => {
    const context = await seed();
    const state = await startAndReturnState(context);

    const result = await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "service-code",
      userId: "intruder",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });
});

describe("CompleteCertificateSigning — credential leg", () => {
  const throughServiceLeg = async (context: Awaited<ReturnType<typeof seed>>) => {
    const state = await startAndReturnState(context);
    const authorise = await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "service-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });
    if (authorise.data?.outcome !== "authorise") throw new Error("expected authorise");
    return stateFrom(authorise.data.redirectUrl);
  };

  it("signs the authorised hash, incorporates it, validates it and records the decision", async () => {
    const context = await seed();
    const state = await throughServiceLeg(context);

    const result = await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "credential-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(result.data).toEqual({ outcome: "signed", approvalId: context.approvalId, sessionId: "session-1" });
    expect(context.provider.signed).toEqual(["ZGlnZXN0"]);
    expect(context.engine.signedWith[0]).toMatchObject({
      signingTime: context.engine.prepared[0]!.signingTime,
      appearance: context.engine.prepared[0]!.appearance,
      signatureValue: "c2lnbmF0dXJl",
    });
    expect(context.decisions[0]).toMatchObject({
      approvalId: context.approvalId,
      decidedByUserId: "manager-1",
      decision: "approved",
      comment: "Within delegated authority.",
      digitalSignature: {
        status: "signed",
        method: "certificate",
        certificate: passedReport.certificate,
        level: "PAdES_BASELINE_LTA",
        validation: { badge: "valid", reason: null },
      },
    });
    const pdf = context.messages.rows[0]!.document!.pdf!;
    expect(pdf.status).toBe("frozen");
    expect(pdf.storagePath).toBe("generated/session-1/instrument-signed-r1.pdf");
    expect(context.storage.objects.get(pdf.storagePath!)!.data.toString()).toContain("%signed");
    expect(context.audit.entries.map((entry) => entry.action)).toContain("signature.signed");
  });

  it("signs on the configured engine choice and timestamps with DigiCert when no authority is set", async () => {
    const context = await seed();
    context.setConfig({ ...CERTIFICATE_CONFIG, signatureEngine: { source: "built-in" }, tsaUrl: null });
    const state = await throughServiceLeg(context);

    await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "credential-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(context.engine.prepared[0]!.engine).toEqual({ source: "built-in" });
    expect(context.engine.signedWith[0]).toMatchObject({ engine: { source: "built-in" }, tsaUrl: DEFAULT_TSA_URL });
    expect(context.engine.validatedWith).toEqual([{ source: "built-in" }]);
  });

  it("keeps the freeze when a later signer is refused, because earlier signatures depend on it", async () => {
    const context = await seed();
    await context.approvals.create({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-earlier",
      requestedByUserId: "operator-1",
      approverSource: "first_level_supervisor",
      approverUserId: "someone",
      status: "approved",
      recordSnapshot: { subjectNodeId: "node-draft" },
    });
    const earlier = [...context.approvals.rows.values()].find((row) => row.nodeId === "node-earlier")!;
    await context.approvals.update(earlier.id, { digitalSignature: { status: "signed", method: "certificate" } });
    const state = await throughServiceLeg(context);
    context.engine.report = { ...passedReport, indication: "INDETERMINATE", subIndication: "NO_CERTIFICATE_CHAIN_FOUND" };

    await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "credential-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(context.messages.rows[0]!.document!.pdf?.status).toBe("frozen");
  });

  it("refuses a signature the engine does not validate, and records no decision", async () => {
    const context = await seed();
    const state = await throughServiceLeg(context);
    context.engine.report = { ...passedReport, indication: "INDETERMINATE", subIndication: "NO_CERTIFICATE_CHAIN_FOUND" };

    const result = await new CompleteCertificateSigning(context.deps).execute({
      state,
      code: "credential-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(result.data).toMatchObject({ outcome: "rejected", reason: "untrusted" });
    expect(context.decisions).toEqual([]);
  });

  it("will not reuse a service-leg state for the credential leg", async () => {
    const context = await seed();
    const serviceState = await startAndReturnState(context);
    await new CompleteCertificateSigning(context.deps).execute({
      state: serviceState,
      code: "service-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    const replay = await new CompleteCertificateSigning(context.deps).execute({
      state: serviceState,
      code: "credential-code",
      userId: "manager-1",
      impersonatorId: null,
      redirectUri: REDIRECT,
    });

    expect(replay.error?.code).toBe("FORBIDDEN");
  });
});
