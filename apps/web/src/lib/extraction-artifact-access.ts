import type { ExtractionRun } from "@rbrasier/domain";
import type { Container } from "@/lib/container";
import { getSessionTokenFromRequest } from "@/lib/session-token";
import { canEditFlow } from "@/server/routers/flow";

export type RunAccess =
  | { ok: true; run: ExtractionRun; userId: string; isAdmin: boolean }
  | { ok: false; status: number; error: string };

// Shared authorisation for every run-artifact REST endpoint (ADR-033 §9): a valid
// session, the extraction_flows flag, and run-ownership through the owning flow's
// edit gate. Knowing a run/document UUID is never itself authorisation — the
// session-REST IDOR fix (v1.59.0) is the cautionary precedent.
export const authoriseRunAccess = async (
  container: Container,
  request: Request,
  runId: string,
): Promise<RunAccess> => {
  const token = getSessionTokenFromRequest(request);
  if (!token) return { ok: false, status: 401, error: "Unauthorized" };

  const session = await container.resolveSession(token);
  if (!session) return { ok: false, status: 401, error: "Unauthorized" };

  const flagEnabled = await container.useCases.isFeatureEnabledForUser.execute(
    session.userId,
    "extraction_flows",
    session.isAdmin,
  );
  if (flagEnabled.error || !flagEnabled.data) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const run = await container.repos.extractionRuns.getRun(runId);
  if (run.error) return { ok: false, status: 404, error: "Run not found" };

  if (!(await canEditFlow(container, run.data.flowId, session.userId, session.isAdmin))) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true, run: run.data, userId: session.userId, isAdmin: session.isAdmin };
};
