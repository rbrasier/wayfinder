import { NextResponse, type NextRequest } from "next/server";
import type { ConversationalNodeConfig } from "@rbrasier/domain";
import { getContainer } from "@/lib/container";
import { accessError, authorizeSessionAccess } from "@/lib/session-access";

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
  { params }: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const { documentId } = await params;
  const container = getContainer();

  const token = getSessionToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authSession = await container.resolveSession(token);
  if (!authSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const messageResult = await container.repos.sessionMessages.findById(documentId);
  if (messageResult.error) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
  if (!messageResult.data || !messageResult.data.document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const message = messageResult.data;
  const documentMeta = message.document!;

  // Collaborative sessions: any participant of the document's session may
  // download it. Authorise against participant membership (scaling wall #11) —
  // knowing the message UUID is not itself authorisation.
  const access = await authorizeSessionAccess(container, message.sessionId, authSession.userId, authSession.isAdmin, {
    requireSend: false,
    allowApprover: true,
  });
  if (!access.authorized) {
    return NextResponse.json({ error: accessError(access.status) }, { status: access.status });
  }

  const { storagePath, filename } = documentMeta;

  const getResult = await container.objectStorage.get(storagePath);
  if (getResult.error) {
    return NextResponse.json(
      { error: "document_unavailable", hint: "regenerate" },
      { status: 410 },
    );
  }

  return new NextResponse(getResult.data as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(getResult.data.length),
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const { documentId } = await params;
  const container = getContainer();

  const token = getSessionToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authSession = await container.resolveSession(token);
  if (!authSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const messageResult = await container.repos.sessionMessages.findById(documentId);
  if (messageResult.error || !messageResult.data) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const message = messageResult.data;
  const sessionResult = await container.repos.sessions.findById(message.sessionId);
  if (sessionResult.error || !sessionResult.data) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const session = sessionResult.data;

  // Collaborative sessions: any participant with send access may regenerate a
  // document, mirroring the write access on the stream route. Authorise against
  // participant membership, not knowledge of the message UUID.
  const detailResult = await container.useCases.getSession.execute(session.id);
  if (detailResult.error || !detailResult.data) {
    return NextResponse.json({ error: "Failed to load session" }, { status: 500 });
  }

  const { flow, nodes, messages } = detailResult.data;

  const accessResult = await container.useCases.resolveSessionAccess.execute({
    session: detailResult.data.session,
    flow,
    userId: authSession.userId,
    isAdmin: authSession.isAdmin,
    isApprover: false,
    allowAutoEnrol: true,
  });
  if (accessResult.error || !accessResult.data.canSend) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const node = nodes.find((n) => n.id === message.stepNodeId);
  if (!node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  const nodeConfig = node.config as unknown as ConversationalNodeConfig;
  if (!nodeConfig.documentTemplatePath) {
    return NextResponse.json({ error: "No template configured for this node" }, { status: 422 });
  }

  await container.repos.sessionMessages
    .updateDocumentStatus(documentId, "pending")
    .catch(() => undefined);

  const result = await container.useCases.generateDocument.execute({
    messageId: documentId,
    sessionId: session.id,
    messages,
    flow,
    node,
  });

  if (result.error) {
    await container.repos.sessionMessages
      .updateDocumentStatus(documentId, "failed")
      .catch(() => undefined);
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, filename: result.data.document.filename });
}
