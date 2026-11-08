import {
  domainError,
  err,
  ok,
  type Approval,
  type Result,
  type SessionDocument,
  type SlotAnchor,
} from "@wayfinder/domain";
import { buildRenderData } from "../document/render-data";
import { loadSlotImages } from "../approvals/approval-values";
import { loadSubjectDocument, subjectRenderValues } from "../approvals/subject-document";
import type { CertificateSigningDeps } from "./certificate-signing-deps";

// Written into each undecided slot before conversion so its position can be
// read back off the PDF. Plain ASCII so every font renders it and text
// extraction finds it whole; the signature appearance is drawn over it.
export const slotMarker = (slotKey: string): string => `WFSLOT_${slotKey}_WF`;

export interface FrozenDocument {
  messageId: string;
  document: SessionDocument;
  pdf: Buffer;
}

// Converts the subject document to the PDF/A that every certificate signature
// on it will be added to (ADR-068 §1). Idempotent: a document already frozen is
// returned as it is, because re-rendering it would invalidate the signatures it
// already carries.
export const freezeDocumentForSigning = async (
  deps: CertificateSigningDeps,
  approval: Approval,
  subjectNodeId: string,
): Promise<Result<FrozenDocument>> => {
  const subject = await loadSubjectDocument(deps, approval.sessionId, subjectNodeId);
  if (!subject) return err(domainError("VALIDATION_FAILED", "There is no document to sign yet."));

  const existing = subject.document.pdf;
  if (existing?.status === "frozen" && existing.storagePath) {
    const stored = await deps.objectStorage.get(existing.storagePath);
    if (stored.error) return stored;
    return ok({ messageId: subject.messageId, document: subject.document, pdf: stored.data });
  }

  const { values, imagePaths } = await subjectRenderValues(deps, approval.sessionId, subjectNodeId, subject);
  const undecided = subject.fields.filter((field) => field.type === "signature" && !values[field.key]);
  for (const field of undecided) values[field.key] = slotMarker(field.key);

  const rendered = deps.documentGenerator.generate({
    templateBytes: subject.templateBytes,
    data: buildRenderData(subject.fields, values),
    images: await loadSlotImages(deps.objectStorage, imagePaths),
  });
  if (rendered.error) return rendered;

  const converted = await deps.pdfConverter.convertDocxToPdfA(rendered.data.bytes);
  if (converted.error) return converted;

  const located = await deps.anchorLocator.locate(converted.data, undecided.map((field) => slotMarker(field.key)));
  if (located.error) return located;
  const slotAnchors: Record<string, SlotAnchor> = {};
  for (const field of undecided) {
    const rectangle = located.data[slotMarker(field.key)];
    if (rectangle) slotAnchors[field.key] = { page: rectangle.page, x: rectangle.x, y: rectangle.y };
  }

  const storagePath = subject.document.storagePath.replace(/\.[a-z0-9]+$/i, "") + "-signed.pdf";
  const put = await deps.objectStorage.put(storagePath, converted.data, "application/pdf");
  if (put.error) return put;

  const frozenAt = deps.now().toISOString();
  const document: SessionDocument = {
    ...subject.document,
    pdf: {
      storagePath,
      sha256: deps.hashBytes(converted.data),
      generatedAt: frozenAt,
      status: "frozen",
      frozenAt,
      slotAnchors,
    },
  };
  const updated = await deps.sessionMessages.updateDocument(subject.messageId, document);
  if (updated.error) return updated;
  return ok({ messageId: subject.messageId, document, pdf: converted.data });
};
