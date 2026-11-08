"use client";

import { useSearchParams } from "next/navigation";
import { SIGNATURE_FAILURE_MESSAGES, type SignatureFailureReason } from "@wayfinder/domain";

const isReason = (value: string | null): value is SignatureFailureReason =>
  value !== null && value in SIGNATURE_FAILURE_MESSAGES;

// What happened at the signing provider, shown when the approver lands back on
// the approvals page (ADR-067 §4). A refusal names its reason, because the fix
// differs — renew a certificate, try again later, or ask the provider.
export function SigningResultBanner() {
  const searchParams = useSearchParams();
  const outcome = searchParams.get("signing");
  if (!outcome) return null;

  const reason = searchParams.get("reason");
  const message =
    outcome === "signed"
      ? "Signed. Your digital signature has been added to the document and the approval recorded."
      : outcome === "rejected"
        ? `Not signed. ${isReason(reason) ? SIGNATURE_FAILURE_MESSAGES[reason] : "The signature could not be completed."} The approval is still waiting.`
        : outcome === "cancelled"
          ? "Signing was cancelled at the provider. The approval is still waiting."
          : `Not signed. ${searchParams.get("message") ?? "The signature could not be completed."}`;
  const success = outcome === "signed";

  return (
    <div
      role="status"
      data-testid="signing-result"
      data-signing-outcome={outcome}
      className={`mx-5 mt-3 rounded-[10px] border px-4 py-3 text-[13px] ${
        success ? "border-[#bfe0cf] bg-[#effaf4] text-[#1f6b4d]" : "border-[#f1d3a8] bg-[#fff7ea] text-[#8a5a1d]"
      }`}
    >
      {message}
    </div>
  );
}
