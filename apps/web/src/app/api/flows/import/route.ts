import { FLOW_ARCHIVE_LIMITS } from "@wayfinder/domain";
import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/lib/container";
import { getSessionTokenFromRequest } from "@/lib/session-token";
import { statusForDomainError } from "@/lib/http-errors";

// Both halves of inspect-then-commit live here, chosen by the `mode` field.
// The client holds the file and posts it twice — once to see what is in it, once
// to commit — which keeps the server stateless and means no half-imported
// archive is ever parked anywhere waiting for a decision.
type ImportMode = "inspect" | "commit";

const isImportMode = (value: unknown): value is ImportMode =>
  value === "inspect" || value === "commit";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const container = getContainer();

  const token = getSessionTokenFromRequest(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const session = await container.resolveSession(token);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file");
  const mode = formData.get("mode");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No archive was provided." }, { status: 400 });
  }
  if (!isImportMode(mode)) {
    return NextResponse.json({ error: "mode must be 'inspect' or 'commit'." }, { status: 400 });
  }

  // The compressed ceiling is applied here, at the edge, before the archive
  // reader is handed anything at all (ADR-049 §7).
  if (file.size > FLOW_ARCHIVE_LIMITS.maxArchiveBytes) {
    const limitMb = Math.floor(FLOW_ARCHIVE_LIMITS.maxArchiveBytes / (1024 * 1024));
    return NextResponse.json(
      { error: `The archive is larger than the ${limitMb} MB limit.` },
      { status: 400 },
    );
  }

  const archive = Buffer.from(await file.arrayBuffer());

  if (mode === "inspect") {
    const inspection = await container.useCases.inspectFlowImport.execute({ archive });
    if (inspection.error) {
      return NextResponse.json(
        { error: inspection.error.message },
        { status: statusForDomainError(inspection.error) },
      );
    }
    return NextResponse.json(inspection.data, { status: 200 });
  }

  const imported = await container.useCases.importFlow.execute({
    archive,
    importedByUserId: session.userId,
  });
  if (imported.error) {
    return NextResponse.json(
      { error: imported.error.message },
      { status: statusForDomainError(imported.error) },
    );
  }

  return NextResponse.json(
    {
      flowId: imported.data.flow.id,
      flowName: imported.data.flow.name,
      unresolved: imported.data.unresolved,
      warnings: imported.data.warnings,
    },
    { status: 201 },
  );
}
