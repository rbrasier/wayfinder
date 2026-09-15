import { NextResponse, type NextRequest } from "next/server";
import type { ResolvedSession } from "@wayfinder/adapters";
import { getContainer } from "@/lib/container";
import { withPrincipal } from "@/lib/with-principal";
import { accessError, authorizeSessionAccess } from "@/lib/session-access";

async function handleDELETE(
  req: NextRequest,
  principal: ResolvedSession,
  { params }: { params: Promise<{ sessionId: string; uploadId: string }> },
): Promise<NextResponse> {
  const { sessionId, uploadId } = await params;
  const container = getContainer();


  const access = await authorizeSessionAccess(container, sessionId, principal.userId, principal.isAdmin, {
    requireSend: true,
    allowApprover: false,
  });
  if (!access.authorized) {
    return NextResponse.json({ error: accessError(access.status) }, { status: access.status });
  }

  const listResult = await container.repos.sessionUploads.listBySession(sessionId);
  if (listResult.error) return NextResponse.json({ error: "Server error" }, { status: 500 });

  const upload = listResult.data.find((u) => u.id === uploadId);
  if (!upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

  const removeResult = await container.useCases.removeSessionUpload.execute(uploadId);
  if (removeResult.error) return NextResponse.json({ error: "Failed to remove upload" }, { status: 500 });

  // Drop the upload's chunks so its content is no longer retrievable.
  await container.repos.documentChunks.deleteByStoragePath(upload.storagePath);

  // Best-effort blob cleanup — the row is already gone, so a storage failure must
  // not surface as an error to the user.
  await container.objectStorage.delete(upload.storagePath).catch(() => undefined);

  return NextResponse.json({ ok: true });
}

// Resolution and the audit actor scope are one operation, so a route cannot
// obtain a principal without the scope that attributes what it does (ADR-060 §3a).
export const DELETE = (
  req: NextRequest,
  context: { params: Promise<{ sessionId: string; uploadId: string }> },
): Promise<NextResponse> =>
  withPrincipal(req, (principal) => handleDELETE(req, principal, context));
