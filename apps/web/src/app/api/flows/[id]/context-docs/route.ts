import { NextResponse, type NextRequest } from "next/server";
import {
  CONTEXT_DOCS_ALLOWED_MIME_TYPES,
  CONTEXT_DOCS_MAX_FILE_SIZE_BYTES,
} from "@rbrasier/shared";
import { getContainer } from "@/lib/container";
import { getSessionTokenFromRequest } from "@/lib/session-token";

const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set(CONTEXT_DOCS_ALLOWED_MIME_TYPES);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: flowId } = await params;
  const container = getContainer();

  const token = getSessionTokenFromRequest(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await container.resolveSession(token);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canvasResult = await container.useCases.getFlowCanvas.execute(flowId);
  if (canvasResult.error || !canvasResult.data) {
    return NextResponse.json({ error: "Flow not found" }, { status: 404 });
  }

  const { flow } = canvasResult.data;
  const canEdit =
    session.isAdmin ||
    flow.ownerUserId === session.userId ||
    flow.permissions.some((p) => p.userId === session.userId && p.role === "owner");
  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > CONTEXT_DOCS_MAX_FILE_SIZE_BYTES) {
    const limitMb = CONTEXT_DOCS_MAX_FILE_SIZE_BYTES / (1024 * 1024);
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

  const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const storageKey = `context/${flowId}/${timestamp}-${safeFilename}`;

  const putResult = await container.objectStorage.put(storageKey, buffer, file.type);
  if (putResult.error) {
    return NextResponse.json({ error: "Failed to store document" }, { status: 500 });
  }

  const upsertResult = await container.repos.contextDocContent.upsert({
    flowId,
    storagePath: storageKey,
    extractedText,
    extractionStatus: "complete",
  });
  if (upsertResult.error) {
    await container.objectStorage.delete(storageKey).catch(() => undefined);
    return NextResponse.json({ error: "Failed to store extracted text" }, { status: 500 });
  }

  const doc = {
    id: crypto.randomUUID(),
    filename: safeFilename,
    mimeType: file.type,
    sizeBytes: file.size,
    storagePath: storageKey,
    extractedText,
    extractionStatus: "complete" as const,
  };

  const result = await container.useCases.addContextDoc.execute(flowId, doc);
  if (result.error) {
    await container.objectStorage.delete(storageKey).catch(() => undefined);
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  const indexResult = await container.services.documentIndexer.indexDocument({
    flowId,
    sessionId: null,
    sourceType: "flow_context_doc",
    storagePath: storageKey,
    filename: safeFilename,
    text: extractedText,
  });
  if (indexResult.error) {
    // The document is stored; only its embeddings are missing. Surface a warning
    // rather than failing the upload — chunks can be regenerated from the stored
    // extracted text (ADR-016 Decision 4).
    container.services.errorLogger.log({
      level: "warn",
      message: "Context document stored but embedding failed",
      stack: null,
      page: `api/flows/${flowId}/context-docs`,
      metadata: { flowId, storagePath: storageKey, error: indexResult.error.message },
    });
  }

  return NextResponse.json(
    {
      ...doc,
      extractedChars: extractedText.length,
      indexed: !indexResult.error,
      chunkCount: indexResult.error ? 0 : indexResult.data.chunkCount,
    },
    { status: 201 },
  );
}
