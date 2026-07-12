import { NextResponse, type NextRequest } from "next/server";
import { sumSessionUploadChars } from "@rbrasier/domain";
import { SESSION_UPLOADS_ALLOWED_MIME_TYPES } from "@rbrasier/shared";
import { getContainer } from "@/lib/container";
import { accessError, authorizeSessionAccess } from "@/lib/session-access";

const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set(SESSION_UPLOADS_ALLOWED_MIME_TYPES);

const getSessionToken = (req: NextRequest): string | null => {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const pair = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("better-auth.session_token="));
  return pair ? pair.slice("better-auth.session_token=".length) : null;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  const { sessionId } = await params;
  const container = getContainer();

  const token = getSessionToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authSession = await container.resolveSession(token);
  if (!authSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await authorizeSessionAccess(container, sessionId, authSession.userId, authSession.isAdmin, {
    requireSend: false,
    allowApprover: true,
  });
  if (!access.authorized) {
    return NextResponse.json({ error: accessError(access.status) }, { status: access.status });
  }

  const result = await container.repos.sessionUploads.listBySession(sessionId);
  if (result.error) return NextResponse.json({ error: "Server error" }, { status: 500 });

  return NextResponse.json(
    result.data.map((upload) => ({
      id: upload.id,
      filename: upload.filename,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
    })),
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  const { sessionId } = await params;
  const container = getContainer();

  const token = getSessionToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authSession = await container.resolveSession(token);
  if (!authSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionResult = await container.useCases.getSession.execute(sessionId);
  if (sessionResult.error) return NextResponse.json({ error: "Server error" }, { status: 500 });
  if (!sessionResult.data) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const { session, flow } = sessionResult.data;

  const accessResult = await container.useCases.resolveSessionAccess.execute({
    session,
    flow,
    userId: authSession.userId,
    isAdmin: authSession.isAdmin,
    isApprover: false,
    allowAutoEnrol: true,
  });
  if (accessResult.error || !accessResult.data.canSend) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (session.status !== "active") {
    return NextResponse.json({ error: "Session is not active" }, { status: 400 });
  }

  const limits = await container.runtimeConfig.getSessionUploadConfig();

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > limits.maxFileSizeBytes) {
    const limitMb = limits.maxFileSizeBytes / (1024 * 1024);
    return NextResponse.json({ error: `File exceeds ${limitMb} MB limit` }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Only PDF, DOCX, TXT, and Markdown files are supported." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const extractionResult = await container.services.documentExtractor.extract({
    buffer,
    mimeType: file.type,
  });
  if (extractionResult.error) {
    return NextResponse.json(
      {
        error:
          "Could not read text from this document. If it is a scanned PDF, run OCR first and re-upload. Otherwise check the file is not corrupted.",
      },
      { status: 422 },
    );
  }

  const extractedText = extractionResult.data.trim();
  if (extractedText.length === 0) {
    return NextResponse.json(
      {
        error:
          "No readable text was found in this document. Scanned PDFs need OCR before upload.",
      },
      { status: 422 },
    );
  }

  // Retrieval (RAG) controls what reaches the prompt now, so the full extracted
  // text is always stored — no per-session character budget guard.
  const existingResult = await container.repos.sessionUploads.listBySession(sessionId);
  const existingUploads = existingResult.error ? [] : existingResult.data;
  const currentTotalChars = sumSessionUploadChars(existingUploads);
  const newTotalChars = currentTotalChars + extractedText.length;

  const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const storageKey = `session/${sessionId}/${timestamp}-${safeFilename}`;

  const putResult = await container.objectStorage.put(storageKey, buffer, file.type);
  if (putResult.error) {
    return NextResponse.json({ error: "Failed to store document" }, { status: 500 });
  }

  const result = await container.useCases.addSessionUpload.execute({
    sessionId,
    filename: safeFilename,
    mimeType: file.type,
    sizeBytes: file.size,
    storagePath: storageKey,
    extractedText,
    extractionStatus: "complete",
  });
  if (result.error) {
    await container.objectStorage.delete(storageKey).catch(() => undefined);
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  const indexResult = await container.services.documentIndexer.indexDocument({
    flowId: null,
    sessionId,
    sourceType: "session_upload",
    storagePath: storageKey,
    filename: safeFilename,
    text: extractedText,
  });
  if (indexResult.error) {
    container.services.errorLogger.log({
      level: "warn",
      message: "Session upload stored but embedding failed",
      stack: null,
      page: `api/chat/${sessionId}/uploads`,
      metadata: { sessionId, storagePath: storageKey, error: indexResult.error.message },
    });
  }

  return NextResponse.json(
    {
      id: result.data.id,
      filename: result.data.filename,
      mimeType: result.data.mimeType,
      sizeBytes: result.data.sizeBytes,
      extractedChars: extractedText.length,
      sessionTotalChars: newTotalChars,
      sessionBudgetChars: limits.totalBudgetChars,
      indexed: !indexResult.error,
      chunkCount: indexResult.error ? 0 : indexResult.data.chunkCount,
    },
    { status: 201 },
  );
}
