import { NextResponse, type NextRequest } from "next/server";
import {
  CONTEXT_DOCS_ALLOWED_MIME_TYPES,
  CONTEXT_DOCS_MAX_FILE_SIZE_BYTES,
  CONTEXT_DOCS_TOTAL_BUDGET_CHARS,
} from "@rbrasier/shared";
import { getContainer } from "@/lib/container";

const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set(CONTEXT_DOCS_ALLOWED_MIME_TYPES);

const getSessionToken = (req: NextRequest): string | null => {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const pair = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("better-auth.session_token="));
  return pair ? pair.slice("better-auth.session_token=".length) : null;
};

const sumExtractedChars = (docs: { extractedText: string | null }[]): number =>
  docs.reduce((total, doc) => total + (doc.extractedText?.length ?? 0), 0);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: flowId } = await params;
  const container = getContainer();

  const token = getSessionToken(req);
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

  const currentTotalChars = sumExtractedChars(flow.contextDocs);
  const newTotalChars = currentTotalChars + extractedText.length;
  if (newTotalChars > CONTEXT_DOCS_TOTAL_BUDGET_CHARS) {
    return NextResponse.json(
      {
        error: `Adding this document would exceed the flow's context budget (${newTotalChars.toLocaleString()} / ${CONTEXT_DOCS_TOTAL_BUDGET_CHARS.toLocaleString()} chars). Remove or shrink an existing document first.`,
        extractedChars: extractedText.length,
        flowTotalChars: currentTotalChars,
        flowBudgetChars: CONTEXT_DOCS_TOTAL_BUDGET_CHARS,
      },
      { status: 413 },
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

  return NextResponse.json(
    {
      ...doc,
      extractedChars: extractedText.length,
      flowTotalChars: newTotalChars,
      flowBudgetChars: CONTEXT_DOCS_TOTAL_BUDGET_CHARS,
    },
    { status: 201 },
  );
}
