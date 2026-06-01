import { NextResponse, type NextRequest } from "next/server";
import { DocxGenerator } from "@rbrasier/adapters";
import { TEMPLATE_STRUCTURED_CONTENT_MAX_CHARS } from "@rbrasier/shared";
import { getContainer } from "@/lib/container";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const getSessionToken = (req: NextRequest): string | null => {
  const cookie = req.headers.get("cookie");
  if (!cookie) return null;
  const pair = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("better-auth.session_token="));
  return pair ? pair.slice("better-auth.session_token=".length) : null;
};

const docxGenerator = new DocxGenerator();

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
): Promise<NextResponse> {
  const { id: flowId, nodeId } = await params;
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

  const node = canvasResult.data.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".docx")) {
    return NextResponse.json({ error: "Only .docx files are accepted" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const validationResult = docxGenerator.extractTags({ templateBytes: buffer });
  if (validationResult.error) {
    return NextResponse.json(
      { error: `Invalid template: ${validationResult.error.message}` },
      { status: 422 },
    );
  }

  if (validationResult.data.tags.length === 0) {
    return NextResponse.json(
      {
        error:
          "This template has no {{ tag }} placeholders. Add at least one tag (e.g. {{ client_name }}) where you want the AI to fill in information, then re-upload.",
        code: "NO_TEMPLATE_TAGS",
      },
      { status: 422 },
    );
  }

  const fieldsResult = docxGenerator.extractFields({ templateBytes: buffer });
  if (fieldsResult.error) {
    return NextResponse.json(
      { error: fieldsResult.error.message, code: "INVALID_TEMPLATE_FIELDS" },
      { status: 422 },
    );
  }

  const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const storageKey = `templates/${nodeId}/${timestamp}-${safeFilename}`;

  const putResult = await container.objectStorage.put(
    storageKey,
    buffer,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  if (putResult.error) {
    return NextResponse.json({ error: "Failed to store template" }, { status: 500 });
  }

  const textResult = docxGenerator.extractFullText({ templateBytes: buffer });
  const documentTemplateContent = textResult.data?.text ?? null;

  if (!documentTemplateContent) {
    return NextResponse.json(
      { error: "Could not extract text from template" },
      { status: 422 },
    );
  }

  const summariseResult = await container.useCases.summariseTemplate.execute({
    fullExtractedText: documentTemplateContent,
    tags: validationResult.data.tags,
  });
  if (summariseResult.error) {
    return NextResponse.json({ error: "Failed to process template" }, { status: 500 });
  }

  const documentTemplateStructuredContent = summariseResult.data.structuredContent;

  if (documentTemplateStructuredContent.length > TEMPLATE_STRUCTURED_CONTENT_MAX_CHARS) {
    return NextResponse.json(
      {
        error: `Template structural content (${documentTemplateStructuredContent.length} chars) exceeds limit of ${TEMPLATE_STRUCTURED_CONTENT_MAX_CHARS} chars. Reduce template length and try again.`,
      },
      { status: 422 },
    );
  }

  const existingConfig = node.config as Record<string, unknown>;
  const previousTemplatePath = existingConfig.documentTemplatePath as string | null;
  const updatedConfig = {
    ...existingConfig,
    documentTemplatePath: storageKey,
    documentTemplateFilename: safeFilename,
    documentTemplateContent,
    documentTemplateStructuredContent,
    documentTemplateFields: fieldsResult.data.fields,
  };

  const updateResult = await container.useCases.updateFlowNode.execute(nodeId, {
    config: updatedConfig,
  });
  if (updateResult.error) {
    return NextResponse.json({ error: "Failed to save template reference" }, { status: 500 });
  }

  // A re-upload gets a fresh storage key, so the previous template's chunks would
  // otherwise linger and keep being retrieved — drop them.
  if (previousTemplatePath && previousTemplatePath !== storageKey) {
    await container.repos.documentChunks.deleteByStoragePath(previousTemplatePath);
  }

  // Index the template prose for retrieval. {{ placeholder }} tags are stripped
  // during chunking (phase doc §7) since they add no semantic signal.
  const indexResult = await container.services.documentIndexer.indexDocument({
    flowId,
    sessionId: null,
    sourceType: "template",
    storagePath: storageKey,
    filename: safeFilename,
    text: documentTemplateContent,
  });
  if (indexResult.error) {
    container.services.errorLogger.log({
      level: "warn",
      message: "Template stored but embedding failed",
      stack: null,
      page: `api/flows/${flowId}/nodes/${nodeId}/template`,
      metadata: { flowId, nodeId, storagePath: storageKey, error: indexResult.error.message },
    });
  }

  return NextResponse.json(
    {
      path: storageKey,
      filename: safeFilename,
      tagCount: validationResult.data.tags.length,
      templateContentLength: documentTemplateStructuredContent.length,
      documentTemplateContent,
      indexed: !indexResult.error,
      chunkCount: indexResult.error ? 0 : indexResult.data.chunkCount,
    },
    { status: 200 },
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
): Promise<NextResponse> {
  const { id: flowId, nodeId } = await params;
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

  const node = canvasResult.data.nodes.find((n) => n.id === nodeId);
  if (!node) return NextResponse.json({ error: "Node not found" }, { status: 404 });

  const existingConfig = node.config as Record<string, unknown>;
  const templateKey = existingConfig.documentTemplatePath as string | null;

  if (templateKey) {
    await container.repos.documentChunks.deleteByStoragePath(templateKey);
    await container.objectStorage.delete(templateKey);
  }

  const updatedConfig = {
    ...existingConfig,
    documentTemplatePath: null,
    documentTemplateFilename: null,
    documentTemplateContent: null,
    documentTemplateStructuredContent: null,
    documentTemplateFields: null,
  };

  const updateResult = await container.useCases.updateFlowNode.execute(nodeId, {
    config: updatedConfig,
  });
  if (updateResult.error) {
    return NextResponse.json({ error: "Failed to remove template reference" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
