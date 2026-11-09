import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNATURE_CONFIG } from "@wayfinder/domain";
import { OffSystemSignedEvidence } from "./off-system-signed-evidence";
import { passedReport, seed, type SigningContext } from "./__fixtures__/certificate-signing-doubles";

const signedPdf = Buffer.from("%PDF-1.7 signed elsewhere");

const approvalOf = (context: SigningContext) => context.approvals.rows.get(context.approvalId)!;

describe("OffSystemSignedEvidence", () => {
  it("is not required when the install does not sign with certificates", async () => {
    const context = await seed();
    context.setConfig({ ...DEFAULT_SIGNATURE_CONFIG });

    const result = await new OffSystemSignedEvidence(context.deps).check(approvalOf(context), {
      mimeType: "image/png",
      bytes: Buffer.from("png"),
    });

    expect(result.data).toEqual({ required: false });
  });

  it("accepts a PDF validly signed by the nominated approver, as the signed record", async () => {
    const context = await seed();

    const result = await new OffSystemSignedEvidence(context.deps).check(approvalOf(context), {
      mimeType: "application/pdf",
      bytes: signedPdf,
    });

    if (!result.data?.required) throw new Error("expected a signed-evidence result");
    expect(result.data.record).toMatchObject({
      status: "signed",
      method: "off_system",
      certificate: passedReport.certificate,
      validation: { badge: "valid" },
    });
    expect(result.data.document.pdf).toMatchObject({ status: "frozen", sha256: `sha-${signedPdf.length}` });
  });

  it("refuses evidence that is not a PDF", async () => {
    const context = await seed();

    const result = await new OffSystemSignedEvidence(context.deps).check(approvalOf(context), {
      mimeType: "image/png",
      bytes: Buffer.from("png"),
    });

    expect(result.error?.message).toBe("On this step the evidence must be the PDF the approver digitally signed.");
  });

  it("refuses a PDF whose signature does not validate, with the reason", async () => {
    const context = await seed();
    context.engine.report = { ...passedReport, indication: "INDETERMINATE", subIndication: "REVOKED_NO_POE" };

    const result = await new OffSystemSignedEvidence(context.deps).check(approvalOf(context), {
      mimeType: "application/pdf",
      bytes: signedPdf,
    });

    expect(result.error?.message).toBe("The signing certificate has been revoked.");
  });

  it("refuses a PDF signed by someone other than the nominated approver", async () => {
    const context = await seed();
    context.engine.report = {
      ...passedReport,
      signedBy: "Someone Else",
      certificate: { ...passedReport.certificate!, subject: "CN=Someone Else" },
    };

    const result = await new OffSystemSignedEvidence(context.deps).check(approvalOf(context), {
      mimeType: "application/pdf",
      bytes: signedPdf,
    });

    expect(result.error?.message).toBe("The PDF was signed by Someone Else, not the nominated approver.");
  });

  it("requires a signature over the frozen document once one exists", async () => {
    const context = await seed();
    await context.storage.put("generated/session-1/instrument-signed.pdf", Buffer.from("%PDF-frozen"), "application/pdf");
    const message = context.messages.rows[0]!;
    message.document = {
      ...message.document!,
      pdf: { storagePath: "generated/session-1/instrument-signed.pdf", sha256: "x", generatedAt: "t", status: "frozen" },
    };
    const evidence = new OffSystemSignedEvidence(context.deps);

    const unrelated = await evidence.check(approvalOf(context), { mimeType: "application/pdf", bytes: signedPdf });
    const overFrozen = await evidence.check(approvalOf(context), {
      mimeType: "application/pdf",
      bytes: Buffer.concat([Buffer.from("%PDF-frozen"), Buffer.from("\n%signature revision")]),
    });

    expect(unrelated.error?.message).toBe("The signed PDF is not a signature over the document frozen for signing.");
    expect(overFrozen.data?.required).toBe(true);
  });

  it("adopts accepted evidence as the document's frozen record", async () => {
    const context = await seed();
    const evidence = new OffSystemSignedEvidence(context.deps);
    const checked = await evidence.check(approvalOf(context), { mimeType: "application/pdf", bytes: signedPdf });
    if (!checked.data?.required) throw new Error("expected a signed-evidence result");

    await evidence.adopt(checked.data, "approval-evidence/appr-1/signed.pdf");

    expect(context.messages.rows[0]!.document!.pdf).toMatchObject({
      status: "frozen",
      storagePath: "approval-evidence/appr-1/signed.pdf",
    });
  });
});
