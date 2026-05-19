import { mkdir, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { DocxGenerator } from "@rbrasier/adapters";
import { getContainer } from "@/lib/container";
import { serverEnv } from "@/lib/env";

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

  const env = serverEnv();
  const safeFilename = basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(env.DOCUMENT_STORAGE_PATH, "templates", nodeId);
  await mkdir(dir, { recursive: true });
  const storagePath = join(dir, `${timestamp}-${safeFilename}`);
  await writeFile(storagePath, buffer);

  const existingConfig = node.config as Record<string, unknown>;
  const updatedConfig = {
    ...existingConfig,
    documentTemplatePath: storagePath,
    documentTemplateFilename: safeFilename,
  };

  const updateResult = await container.useCases.updateFlowNode.execute(nodeId, {
    config: updatedConfig,
  });
  if (updateResult.error) {
    return NextResponse.json({ error: "Failed to save template reference" }, { status: 500 });
  }

  return NextResponse.json(
    { path: storagePath, filename: safeFilename, tagCount: validationResult.data.tags.length },
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
  const updatedConfig = {
    ...existingConfig,
    documentTemplatePath: null,
    documentTemplateFilename: null,
  };

  const updateResult = await container.useCases.updateFlowNode.execute(nodeId, {
    config: updatedConfig,
  });
  if (updateResult.error) {
    return NextResponse.json({ error: "Failed to remove template reference" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
