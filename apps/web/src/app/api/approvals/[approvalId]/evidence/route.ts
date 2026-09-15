import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/lib/container";
import { getSessionTokenFromRequest } from "@/lib/session-token";
import { accessError, authorizeSessionAccess } from "@/lib/session-access";

// Serves the file filed as proof that an approval happened off system
// (ADR-055 §7).
//
// Authorised through the approval's own session rather than through the
// approval's assignee list: the evidence is part of that session's governed
// record, so everyone who can read the chat can read what was filed against it —
// including the operator who filed it, who is not the approver and would fail an
// assignee-only check. Knowing the id is not itself authorisation.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ approvalId: string }> },
): Promise<NextResponse> {
  const { approvalId } = await params;
  const container = getContainer();

  const token = getSessionTokenFromRequest(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authSession = await container.resolveSession(token);
  if (!authSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const approvalResult = await container.repos.approvals.findById(approvalId);
  if (approvalResult.error) return NextResponse.json({ error: "Server error" }, { status: 500 });

  const approval = approvalResult.data;
  if (!approval) return NextResponse.json({ error: "Approval not found" }, { status: 404 });

  const access = await authorizeSessionAccess(
    container,
    approval.sessionId,
    authSession.userId,
    authSession.isAdmin,
    { requireSend: false, allowApprover: true },
  );
  if (!access.authorized) {
    return NextResponse.json({ error: accessError(access.status) }, { status: access.status });
  }

  if (!approval.offSystemEvidenceStoragePath) {
    return NextResponse.json({ error: "No evidence filed on this approval" }, { status: 404 });
  }

  const bytes = await container.objectStorage.get(approval.offSystemEvidenceStoragePath);
  if (bytes.error) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });

  const filename = approval.offSystemEvidenceFilename ?? "approval-evidence";
  return new NextResponse(new Uint8Array(bytes.data), {
    headers: {
      "Content-Type": approval.offSystemEvidenceMimeType ?? "application/octet-stream",
      // Always an attachment: the file is arbitrary uploaded content, and
      // rendering it inline would run it on this origin.
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "Content-Length": String(bytes.data.byteLength),
    },
  }) as NextResponse;
}
