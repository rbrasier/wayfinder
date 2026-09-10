import { NextResponse, type NextRequest } from "next/server";
import { DocxGenerator, XlsxGenerator } from "@rbrasier/adapters";
import type { DomainErrorDetail, IDocumentGenerator, TemplateField } from "@rbrasier/domain";
import { getContainer, type Container } from "@/lib/container";
import { getSessionTokenFromRequest } from "@/lib/session-token";

export const MAX_TEMPLATE_FILE_SIZE = 10 * 1024 * 1024;

export type TemplateFormat = "docx" | "xlsx";

export const TEMPLATE_MIME: Record<TemplateFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const docxGenerator = new DocxGenerator();
const xlsxGenerator = new XlsxGenerator();

export const generatorFor = (format: TemplateFormat): IDocumentGenerator =>
  format === "xlsx" ? xlsxGenerator : docxGenerator;

interface TemplateNodeAccess {
  container: Container;
  node: { id: string; config: Record<string, unknown> };
}

// Resolves the caller's session and confirms they may edit this flow's nodes.
// Every template verb shares it so read, write and delete cannot drift apart.
export const authoriseTemplateNode = async (
  req: NextRequest,
  flowId: string,
  nodeId: string,
): Promise<{ data: TemplateNodeAccess; error?: undefined } | { data?: undefined; error: NextResponse }> => {
  const container = getContainer();

  const token = getSessionTokenFromRequest(req);
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const session = await container.resolveSession(token);
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const canvasResult = await container.useCases.getFlowCanvas.execute(flowId);
  if (canvasResult.error || !canvasResult.data) {
    return { error: NextResponse.json({ error: "Flow not found" }, { status: 404 }) };
  }

  const { flow } = canvasResult.data;
  const canEdit =
    session.isAdmin ||
    flow.ownerUserId === session.userId ||
    flow.permissions.some((p) => p.userId === session.userId && p.role === "owner");

  if (!canEdit) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const node = canvasResult.data.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return { error: NextResponse.json({ error: "Node not found" }, { status: 404 }) };
  }

  return { data: { container, node: { id: node.id, config: node.config as Record<string, unknown> } } };
};

export interface UploadedTemplate {
  buffer: Buffer;
  format: TemplateFormat;
  safeFilename: string;
}

// Validates the multipart file the browser sent: size, extension, and the safe
// filename used for the storage key.
export const readUploadedTemplate = async (
  formData: FormData,
): Promise<{ data: UploadedTemplate; error?: undefined } | { data?: undefined; error: NextResponse }> => {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { error: NextResponse.json({ error: "No file provided" }, { status: 400 }) };
  }

  if (file.size > MAX_TEMPLATE_FILE_SIZE) {
    return { error: NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 400 }) };
  }

  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".docx") && !lowerName.endsWith(".xlsx")) {
    return {
      error: NextResponse.json(
        { error: "Only .docx and .xlsx files are accepted" },
        { status: 400 },
      ),
    };
  }

  return {
    data: {
      buffer: Buffer.from(await file.arrayBuffer()),
      format: lowerName.endsWith(".xlsx") ? "xlsx" : "docx",
      safeFilename: file.name.replace(/[^a-zA-Z0-9._-]/g, "_"),
    },
  };
};

export interface TemplateExtraction {
  tags: string[];
  fields: TemplateField[];
  documentTemplateContent: string;
  spreadsheetTemplateMode: "tags" | "header" | null;
}

export interface ExtractionFailure {
  status: number;
  // `details` names each malformed {{ tag }} so the author can find it in Word
  // rather than hunting through a hundred of them (issue #286). `error` always
  // stands on its own, so a client may ignore it.
  body: { error: string; code?: string; details?: readonly DomainErrorDetail[] };
}

// Reduces a template to the fields a conversation must gather, the prose to
// summarise/index, and (for xlsx) the detected authoring mode. Mirrors the .docx
// validation for .xlsx via the XlsxGenerator (ADR-039).
//
// `requireTags` is false on the guided path: a document with no placeholders is
// exactly what the annotation flow exists to fix, so rejecting it there would
// send the author back to Word — the failure mode this feature removes.
export const extractTemplate = (
  format: TemplateFormat,
  buffer: Buffer,
  requireTags = true,
): { data: TemplateExtraction; error?: undefined } | { data?: undefined; error: ExtractionFailure } => {
  const generator = generatorFor(format);

  const tagsResult = generator.extractTags({ templateBytes: buffer });
  if (tagsResult.error) {
    return {
      error: {
        status: 422,
        body: {
          error: `Invalid template: ${tagsResult.error.message}`,
          ...(tagsResult.error.details ? { details: tagsResult.error.details } : {}),
        },
      },
    };
  }

  if (requireTags && format === "docx" && tagsResult.data.tags.length === 0) {
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

  const textResult = generator.extractFullText({ templateBytes: buffer });
  const documentTemplateContent = textResult.data?.text ?? null;
  if (!documentTemplateContent) {
    return { error: { status: 422, body: { error: "Could not extract text from template" } } };
  }

  // An unannotated .xlsx has no fields to parse yet — header mode needs a usable
  // header row, which a blank or prose-only sheet will not have. On the guided
  // path that is a document to annotate, not an error.
  const fieldsResult = generator.extractFields({ templateBytes: buffer });
  if (fieldsResult.error) {
    if (requireTags) {
      return {
        error: {
          status: 422,
          body: {
            error: fieldsResult.error.message,
            code: "INVALID_TEMPLATE_FIELDS",
            ...(fieldsResult.error.details ? { details: fieldsResult.error.details } : {}),
          },
        },
      };
    }
    return {
      data: {
        tags: tagsResult.data.tags,
        fields: [],
        documentTemplateContent,
        spreadsheetTemplateMode: null,
      },
    };
  }

  // Recomputed from these bytes rather than carried over: annotating an .xlsx
  // writes tags into it, which moves it to tag mode (ADR-039 precedence).
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
