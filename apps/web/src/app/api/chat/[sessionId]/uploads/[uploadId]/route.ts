import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/lib/container";

const getSessionToken = (req: NextRequest): string | null => {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const pair = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("better-auth.session_token="));
  return pair ? pair.slice("better-auth.session_token=".length) : null;
};

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; uploadId: string }> },
): Promise<NextResponse> {
  const { sessionId, uploadId } = await params;
  const container = getContainer();

  const token = getSessionToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authSession = await container.resolveSession(token);
  if (!authSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
