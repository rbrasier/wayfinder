import { NextResponse, type NextRequest } from "next/server";
import type { ResolvedSession } from "@wayfinder/adapters";
import { getContainer } from "@/lib/container";
import { withPrincipal } from "@/lib/with-principal";
import { signingCallbackUrl } from "@/lib/signing-callback";

// The signing provider's redirect back, for both OAuth legs (ADR-067 §4). The
// use case decides what happens next; this route only turns its outcome into
// where the approver's browser goes.
async function handleGET(req: NextRequest, principal: ResolvedSession): Promise<NextResponse> {
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const providerError = req.nextUrl.searchParams.get("error");
  const back = (query: Record<string, string>) =>
    NextResponse.redirect(new URL(`/approvals?${new URLSearchParams(query).toString()}`, req.url), 302);

  if (providerError || !state || !code) return back({ signing: "cancelled" });

  const result = await getContainer().useCases.completeCertificateSigning.execute({
    state,
    code,
    userId: principal.userId,
    impersonatorId: principal.impersonatorId,
    redirectUri: signingCallbackUrl(),
  });
  if (result.error) return back({ signing: "failed", message: result.error.message });

  const outcome = result.data;
  if (outcome.outcome === "authorise") return NextResponse.redirect(outcome.redirectUrl, 302);
  if (outcome.outcome === "rejected") return back({ signing: "rejected", reason: outcome.reason });
  return back({ signing: "signed", approval: outcome.approvalId });
}

export const GET = (req: NextRequest): Promise<NextResponse> =>
  withPrincipal(req, (principal) => handleGET(req, principal));
