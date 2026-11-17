import { describe, expect, it } from "vitest";
import { downloadOptions, showsDocumentCard, showsEditAffordance } from "./document-card-state";

describe("showsDocumentCard", () => {
  it("shows the card for a message carrying a document", () => {
    expect(showsDocumentCard({ hasDocument: true, isAdvancing: true })).toBe(true);
  });

  // The bug this rule exists to fix. The card used to render only inside the
  // milestone branch, so a session returning to the step — which is what a
  // withdrawal does — made the document vanish from the history.
  it("keeps the card when the step is current again after a withdrawal", () => {
    expect(showsDocumentCard({ hasDocument: true, isAdvancing: false })).toBe(true);
  });

  it("shows nothing for a message with no document", () => {
    expect(showsDocumentCard({ hasDocument: false, isAdvancing: true })).toBe(false);
    expect(showsDocumentCard({ hasDocument: false, isAdvancing: false })).toBe(false);
  });
});

describe("showsEditAffordance", () => {
  const base = {
    canEditDocuments: true,
    allowManualEdit: true,
    isOnApprovalNode: false,
  };

  it("offers editing on an ordinary completed step", () => {
    expect(showsEditAffordance(base)).toBe(true);
  });

  // The author must not be editing the thing under review. Hidden rather than
  // disabled: there is nothing they can do about it, so a greyed button is only
  // a question they cannot answer.
  it("hides editing while the session is parked on an approval node", () => {
    expect(showsEditAffordance({ ...base, isOnApprovalNode: true })).toBe(false);
  });

  // Withdrawing moves the session off the approval node, which is what makes
  // "edit the document directly rather than chat" reachable.
  it("returns editing once the request is withdrawn", () => {
    const pending = showsEditAffordance({ ...base, isOnApprovalNode: true });
    const withdrawn = showsEditAffordance({ ...base, isOnApprovalNode: false });

    expect(pending).toBe(false);
    expect(withdrawn).toBe(true);
  });

  it("respects a node that forbids manual editing", () => {
    expect(showsEditAffordance({ ...base, allowManualEdit: false })).toBe(false);
  });

  it("respects a read-only or closed session", () => {
    expect(showsEditAffordance({ ...base, canEditDocuments: false })).toBe(false);
  });
});

describe("downloadOptions", () => {
  it("offers the PDF first and the Word file second once a PDF exists", () => {
    const options = downloadOptions({ filename: "contract.docx", pdf: { storagePath: "a/contract.pdf", status: "frozen" } });

    expect(options).toEqual([
      { format: "pdf", label: "↓ PDF", primary: true },
      { format: "original", label: "↓ DOCX", primary: false },
    ]);
  });

  it("offers the PDF first for a rendered, unsigned PDF too", () => {
    const options = downloadOptions({ filename: "memo.docx", pdf: { storagePath: "a/memo.pdf", status: "rendered" } });

    expect(options.map((option) => option.format)).toEqual(["pdf", "original"]);
  });

  it("offers the original file alone when there is no PDF", () => {
    expect(downloadOptions({ filename: "contract.docx" })).toEqual([
      { format: "original", label: "↓ Download", primary: true },
    ]);
  });

  // A failed conversion stores no file, and a superseded PDF is no longer the
  // record: neither is offered.
  it.each([
    { storagePath: null, status: "failed" },
    { storagePath: "a/contract.pdf", status: "superseded" },
  ])("offers no PDF when it is $status", (pdf) => {
    expect(downloadOptions({ filename: "contract.docx", pdf }).map((option) => option.format)).toEqual(["original"]);
  });
});
