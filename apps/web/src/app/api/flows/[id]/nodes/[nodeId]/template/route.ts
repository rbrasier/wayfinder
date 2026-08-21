import { NextResponse, type NextRequest } from "next/server";
import type { TemplateAnnotationEdit } from "@rbrasier/domain";
import { TEMPLATE_STRUCTURED_CONTENT_MAX_CHARS } from "@rbrasier/shared";
import type { Container } from "@/lib/container";
import { buildAnnotationEdits, type AnnotationRow } from "@/lib/template-annotation";
import {
  authoriseTemplateNode,
  extractTemplate,
  generatorFor,
  readUploadedTemplate,
  TEMPLATE_MIME,
  type TemplateFormat,
} from "@/lib/template-route-helpers";

const parseAnnotationRows = (raw: FormDataEntryValue | null): AnnotationRow[] | null => {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AnnotationRow[]) : null;
  } catch {
    return null;
  }
};

// Writes the reviewed placeholders into the uploaded bytes. The upload itself is
// never mutated — annotate() returns a new document, and only that derived
// version is stored.
const applyAnnotations = (
  format: TemplateFormat,
  buffer: Buffer,
  edits: TemplateAnnotationEdit[],
): { data: Buffer; error?: undefined } | { data?: undefined; error: NextResponse } => {
  if (edits.length === 0) return { data: buffer };

  const annotated = generatorFor(format).annotate({ templateBytes: buffer, edits });
  if (annotated.error) {
    return { error: NextResponse.json({ error: annotated.error.message }, { status: 422 }) };
  }

  if (annotated.data.unmatched.length > 0) {
    return {
      error: NextResponse.json(
        {
          error: `${annotated.data.unmatched.length} field${annotated.data.unmatched.length === 1 ? "" : "s"} could not be placed in the document. The document may have changed since it was analysed — re-upload it and try again.`,
          code: "ANNOTATION_UNMATCHED",
          unmatched: annotated.data.unmatched.map((edit) => edit.find),
        },
        { status: 422 },
      ),
    };
  }

  return { data: annotated.data.bytes };
};

interface StoreTemplateInput {
  container: Container;
  flowId: string;
  nodeId: string;
  nodeConfig: Record<string, unknown>;
  buffer: Buffer;
  format: TemplateFormat;
  safeFilename: string;
}

// The shared persistence pipeline: store the bytes, summarise and index the
// prose, and point the node config at the new template. Used by both the upload
// path and the re-annotation path so the two cannot diverge.
const storeTemplate = async (input: StoreTemplateInput): Promise<NextResponse> => {
  const { container, flowId, nodeId, nodeConfig, buffer, format, safeFilename } = input;

  const extraction = extractTemplate(format, buffer);
  if (extraction.error) {
    return NextResponse.json(extraction.error.body, { status: extraction.error.status });
  }
  const { tags, fields, documentTemplateContent, spreadsheetTemplateMode } = extraction.data;

  // An unregistered (options-source: …) fails here, so the author sees it while
  // editing the template rather than an operator hitting it mid-session.
  const sourcesResult = await container.useCases.validateTemplateLookupSources.execute(fields);
  if (sourcesResult.error) {
    return NextResponse.json({ error: sourcesResult.error.message }, { status: 422 });
  }

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

  const previousTemplatePath = nodeConfig.documentTemplatePath as string | null;
  const updatedConfig = {
    ...nodeConfig,
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
  // otherwise linger and keep being retrieved — drop them. The file itself stays:
  // published flow versions snapshot the node config, so an older version still
  // points at that key and must remain restorable.
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
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
): Promise<NextResponse> {
  const { id: flowId, nodeId } = await params;

  const access = await authoriseTemplateNode(req, flowId, nodeId);
  if (access.error) return access.error;
  const { container, node } = access.data;

  const formData = await req.formData();
  const upload = await readUploadedTemplate(formData);
  if (upload.error) return upload.error;

  const rows = parseAnnotationRows(formData.get("annotations"));
  const annotated = applyAnnotations(
    upload.data.format,
    upload.data.buffer,
    rows ? buildAnnotationEdits(rows) : [],
  );
  if (annotated.error) return annotated.error;

  return storeTemplate({
    container,
    flowId,
    nodeId,
    nodeConfig: node.config,
    buffer: annotated.data,
    format: upload.data.format,
    safeFilename: upload.data.safeFilename,
  });
}

// Re-annotates the template already attached to this node, with no re-upload.
// Field configuration changes far more often than templates are replaced, so
// this path must not require a round-trip through the file picker.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
): Promise<NextResponse> {
  const { id: flowId, nodeId } = await params;

  const access = await authoriseTemplateNode(req, flowId, nodeId);
  if (access.error) return access.error;
  const { container, node } = access.data;

  const storagePath = node.config.documentTemplatePath as string | null;
  const filename = node.config.documentTemplateFilename as string | null;
  if (!storagePath || !filename) {
    return NextResponse.json({ error: "This step has no template to edit" }, { status: 404 });
  }

  const body = (await req.json()) as { annotations?: unknown };
  const rows = Array.isArray(body.annotations) ? (body.annotations as AnnotationRow[]) : null;
  if (!rows) {
    return NextResponse.json({ error: "No field changes provided" }, { status: 400 });
  }

  const stored = await container.objectStorage.get(storagePath);
  if (stored.error) {
    return NextResponse.json({ error: "Failed to read the stored template" }, { status: 500 });
  }

  const format: TemplateFormat = filename.toLowerCase().endsWith(".xlsx") ? "xlsx" : "docx";
  const annotated = applyAnnotations(format, stored.data, buildAnnotationEdits(rows));
  if (annotated.error) return annotated.error;

  return storeTemplate({
    container,
    flowId,
    nodeId,
    nodeConfig: node.config,
    buffer: annotated.data,
    format,
    safeFilename: filename,
  });
}

// Streams the annotated template back so the author can keep their master copy
// in sync with the fields configured in the app.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
): Promise<NextResponse> {
  const { id: flowId, nodeId } = await params;

  const access = await authoriseTemplateNode(req, flowId, nodeId);
  if (access.error) return access.error;
  const { container, node } = access.data;

  const storagePath = node.config.documentTemplatePath as string | null;
  const filename = node.config.documentTemplateFilename as string | null;
  if (!storagePath || !filename) {
    return NextResponse.json({ error: "This step has no template" }, { status: 404 });
  }

  const stored = await container.objectStorage.get(storagePath);
  if (stored.error) {
    return NextResponse.json({ error: "Failed to read the stored template" }, { status: 500 });
  }

  const format: TemplateFormat = filename.toLowerCase().endsWith(".xlsx") ? "xlsx" : "docx";
  return new NextResponse(new Uint8Array(stored.data), {
    status: 200,
    headers: {
      "Content-Type": TEMPLATE_MIME[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
): Promise<NextResponse> {
  const { id: flowId, nodeId } = await params;

  const access = await authoriseTemplateNode(req, flowId, nodeId);
  if (access.error) return access.error;
  const { container, node } = access.data;

  const templateKey = node.config.documentTemplatePath as string | null;

  if (templateKey) {
    await container.repos.documentChunks.deleteByStoragePath(templateKey);
    await container.objectStorage.delete(templateKey);
  }

  const updatedConfig = {
    ...node.config,
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
