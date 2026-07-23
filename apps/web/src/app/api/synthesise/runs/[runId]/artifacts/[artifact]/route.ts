import { NextResponse, type NextRequest } from "next/server";
import { loadExtractionSchemaForVersion } from "@rbrasier/application";
import type { ExtractionSchema } from "@rbrasier/domain";
import { getContainer } from "@/lib/container";
import { authoriseRunAccess } from "@/lib/extraction-artifact-access";

const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json",
  md: "text/markdown",
};

interface Artifact {
  key: string;
  mime: string;
  filename: string;
}

const summaryExtension = (schema: ExtractionSchema): "docx" | "xlsx" =>
  schema.output.summaryTemplate?.filename.toLowerCase().endsWith(".xlsx") ? "xlsx" : "docx";

// Resolves the requested artifact to a deterministic storage key — the caller
// never supplies a storage path, so a key can't be forged to reach another run's
// objects. Format-dependent artifacts read the run's pinned schema.
const resolveArtifact = async (
  container: ReturnType<typeof getContainer>,
  runId: string,
  flowVersionId: string,
  artifact: string,
): Promise<Artifact | null> => {
  const shortId = runId.slice(0, 8);
  const base = `extraction-runs/${runId}`;

  if (artifact === "export-xlsx") {
    return { key: `${base}/exports/results.xlsx`, mime: MIME.xlsx!, filename: `run-${shortId}-results.xlsx` };
  }
  if (artifact === "export-json") {
    return { key: `${base}/exports/results.json`, mime: MIME.json!, filename: `run-${shortId}-results.json` };
  }
  if (artifact === "summary") {
    return { key: `${base}/outputs/summary.md`, mime: MIME.md!, filename: `run-${shortId}-summary.md` };
  }

  const schema = await loadExtractionSchemaForVersion(container.repos.flowVersions, flowVersionId);
  if (schema.error) return null;

  if (artifact === "document") {
    const ext = schema.data.output.format;
    return { key: `${base}/outputs/document.${ext}`, mime: MIME[ext]!, filename: `run-${shortId}.${ext}` };
  }
  if (artifact === "summary-doc") {
    const ext = summaryExtension(schema.data);
    return { key: `${base}/outputs/summary.${ext}`, mime: MIME[ext]!, filename: `run-${shortId}-summary.${ext}` };
  }

  return null;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; artifact: string }> },
): Promise<NextResponse> {
  const { runId, artifact } = await params;
  const container = getContainer();

  const access = await authoriseRunAccess(container, request, runId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const resolved = await resolveArtifact(container, runId, access.run.flowVersionId, artifact);
  if (!resolved) return NextResponse.json({ error: "Unknown artifact" }, { status: 404 });

  const bytes = await container.objectStorage.get(resolved.key);
  if (bytes.error) {
    return NextResponse.json({ error: "artifact_unavailable", hint: "regenerate" }, { status: 410 });
  }

  return new NextResponse(bytes.data as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": resolved.mime,
      "Content-Disposition": `attachment; filename="${resolved.filename}"`,
      "Content-Length": String(bytes.data.length),
    },
  });
}
