import { NextResponse, type NextRequest } from "next/server";
import { DocxGenerator, XlsxGenerator } from "@rbrasier/adapters";
import type { TemplateField } from "@rbrasier/domain";
import { TEMPLATE_STRUCTURED_CONTENT_MAX_CHARS } from "@rbrasier/shared";
import { getContainer } from "@/lib/container";
import { getSessionTokenFromRequest } from "@/lib/session-token";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

type TemplateFormat = "docx" | "xlsx";

const TEMPLATE_MIME: Record<TemplateFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const docxGenerator = new DocxGenerator();
const xlsxGenerator = new XlsxGenerator();

interface TemplateExtraction {
  tags: string[];
  fields: TemplateField[];
  documentTemplateContent: string;
  spreadsheetTemplateMode: "tags" | "header" | null;
}

interface ExtractionFailure {
  status: number;
  body: { error: string; code?: string };
}

// Reduces an uploaded template to the fields a conversation must gather, the
// prose to summarise/index, and (for xlsx) the detected authoring mode. Mirrors
// the .docx validation for .xlsx via the XlsxGenerator (ADR-039): any {{ tag }}
// ⇒ tag mode, otherwise the header row's headings; a file with neither is
// rejected here rather than mid-session.
const extractTemplate = (
  format: TemplateFormat,
  buffer: Buffer,
): { data: TemplateExtraction; error?: undefined } | { data?: undefined; error: ExtractionFailure } => {
  const generator = format === "xlsx" ? xlsxGenerator : docxGenerator;

  const tagsResult = generator.extractTags({ templateBytes: buffer });
  if (tagsResult.error) {
    return { error: { status: 422, body: { error: `Invalid template: ${tagsResult.error.message}` } } };
  }

  // A .docx with no tags cannot capture anything; a .xlsx with no tags is valid
  // (header mode), so only .docx is rejected here.
  if (format === "docx" && tagsResult.data.tags.length === 0) {
    return {
      error: {
        status: 422,
        body: {
          error:
            "This template has no {{ tag }} placeholders. Add at least one tag (e.g. {{ client_name }}) where you want the AI to fill in information, then re-upload.",
          code: "NO_TEMPLATE_TAGS",
        },
      },
    };
  }

  const fieldsResult = generator.extractFields({ templateBytes: buffer });
  if (fieldsResult.error) {
    return { error: { status: 422, body: { error: fieldsResult.error.message, code: "INVALID_TEMPLATE_FIELDS" } } };
  }

  const textResult = generator.extractFullText({ templateBytes: buffer });
  const documentTemplateContent = textResult.data?.text ?? null;
  if (!documentTemplateContent) {
    return { error: { status: 422, body: { error: "Could not extract text from template" } } };
  }

  const spreadsheetTemplateMode =
    format === "xlsx" ? (tagsResult.data.tags.length > 0 ? "tags" : "header") : null;

  return {
    data: {
      tags: tagsResult.data.tags,
      fields: fieldsResult.data.fields,
      documentTemplateContent,
      spreadsheetTemplateMode,
    },
  };
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
): Promise<NextResponse> {
  const { id: flowId, nodeId } = await params;
  const container = getContainer();

  const token = getSessionTokenFromRequest(req);
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

  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".docx") && !lowerName.endsWith(".xlsx")) {
    return NextResponse.json({ error: "Only .docx and .xlsx files are accepted" }, { status: 400 });
  }
  const format: TemplateFormat = lowerName.endsWith(".xlsx") ? "xlsx" : "docx";

  const buffer = Buffer.from(await file.arrayBuffer());

  const extraction = extractTemplate(format, buffer);
  if (extraction.error) {
    return NextResponse.json(extraction.error.body, { status: extraction.error.status });
  }
  const { tags, fields, documentTemplateContent, spreadsheetTemplateMode } = extraction.data;

  const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const storageKey = `templates/${nodeId}/${timestamp}-${safeFilename}`;

  const putResult = await container.objectStorage.put(storageKey, buffer, TEMPLATE_MIME[format]);
  if (putResult.error) {
    return NextResponse.json({ error: "Failed to store template" }, { status: 500 });
  }

  const summariseResult = await container.useCases.summariseTemplate.execute({
    fullExtractedText: documentTemplateContent,
    tags,
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
    documentTemplateFields: fields,
    documentTemplateFormat: format,
    spreadsheetTemplateMode,
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
      tagCount: tags.length,
      templateContentLength: documentTemplateStructuredContent.length,
      documentTemplateContent,
      documentTemplateFields: fields,
      documentTemplateFormat: format,
      spreadsheetTemplateMode,
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
    documentTemplateFormat: null,
    spreadsheetTemplateMode: null,
  };

  const updateResult = await container.useCases.updateFlowNode.execute(nodeId, {
    config: updatedConfig,
  });
  if (updateResult.error) {
    return NextResponse.json({ error: "Failed to remove template reference" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
