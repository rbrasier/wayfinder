import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/lib/container";
import { authoriseRunAccess } from "@/lib/extraction-artifact-access";

// Downloads a run's input document so the operator can compare input against
// output (phase §4). Ownership is checked through the document's run, not through
// the document UUID (ADR-033 §9 — IDOR precedent).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  const { documentId } = await params;
  const container = getContainer();

  const document = await container.repos.extractionRuns.getDocument(documentId);
  if (document.error) return NextResponse.json({ error: "Server error" }, { status: 500 });
  if (!document.data) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const access = await authoriseRunAccess(container, request, document.data.runId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const bytes = await container.objectStorage.get(document.data.storageKey);
  if (bytes.error) {
    return NextResponse.json({ error: "document_unavailable" }, { status: 410 });
  }

  return new NextResponse(bytes.data as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": document.data.mimeType,
      "Content-Disposition": `attachment; filename="${document.data.filename}"`,
      "Content-Length": String(bytes.data.length),
    },
  });
}
