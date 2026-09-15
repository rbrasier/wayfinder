import { NextResponse, type NextRequest } from "next/server";
import type { ResolvedSession } from "@wayfinder/adapters";
import { getContainer } from "@/lib/container";
import { withPrincipal } from "@/lib/with-principal";
import { statusForDomainError } from "@/lib/http-errors";

// Downloads a flow as a portable archive. A binary body, so it is a route
// handler rather than a tRPC procedure (PRD §7). Authorisation is the
// use-case's — owner or admin — and it is enforced there rather than here so
// the rule has one home.
async function handleGET(
  req: NextRequest,
  principal: ResolvedSession,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: flowId } = await params;
  const container = getContainer();


  const result = await container.useCases.exportFlow.execute({
    flowId,
    requestedByUserId: principal.userId,
    isAdmin: principal.isAdmin,
  });

  if (result.error) {
    return NextResponse.json(
      { error: result.error.message },
      { status: statusForDomainError(result.error) },
    );
  }

  return new NextResponse(new Uint8Array(result.data.archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${result.data.filename}"`,
      "Content-Length": String(result.data.archive.length),
      // An archive carries prompt IP and whole context documents; nothing about
      // it should sit in a shared cache.
      "Cache-Control": "no-store",
    },
  });
}

// Resolution and the audit actor scope are one operation, so a route cannot
// obtain a principal without the scope that attributes what it does (ADR-060 §3a).
export const GET = (
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> =>
  withPrincipal(req, (principal) => handleGET(req, principal, context));
