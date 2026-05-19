import { mkdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/lib/container";
import { serverEnv } from "@/lib/env";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const getSessionToken = (req: NextRequest): string | null => {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const pair = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("better-auth.session_token="));
  return pair ? pair.slice("better-auth.session_token=".length) : null;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: flowId } = await params;
  const container = getContainer();

  const token = getSessionToken(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await container.resolveSession(token);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canvasResult = await container.useCases.getFlowCanvas.execute(flowId);
  if (canvasResult.error || !canvasResult.data) {
    return NextResponse.json({ error: "Flow not found" }, { status: 404 });
  }

  const { flow } = canvasResult.data;
  const canEdit =
    session.isAdmin ||
    flow.ownerUserId === session.userId ||
    flow.permissions.some((p) => p.userId === session.userId && p.role === "owner");

  if (!canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File exceeds 20 MB limit" }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
  }

  const env = serverEnv();
  const storageBase = env.DOCUMENT_STORAGE_PATH;
  const dir = join(storageBase, "context", flowId);
  await mkdir(dir, { recursive: true });

  const safeFilename = basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = join(dir, safeFilename);
  const buffer = await file.arrayBuffer();
  await writeFile(storagePath, Buffer.from(buffer));

  const doc = {
    id: crypto.randomUUID(),
    filename: safeFilename,
    mimeType: file.type,
    sizeBytes: file.size,
    storagePath,
  };

  const result = await container.useCases.addContextDoc.execute(flowId, doc);
  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json(doc, { status: 201 });
}
