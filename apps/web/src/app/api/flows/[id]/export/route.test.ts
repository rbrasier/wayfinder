import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveSession = vi.fn();
const exportExecute = vi.fn();

vi.mock("@/lib/container", () => ({
  getContainer: () => ({ resolveSession, useCases: { exportFlow: { execute: exportExecute } } }),
}));

vi.mock("@/lib/session-token", () => ({
  getSessionTokenFromRequest: (req: NextRequest) => req.headers.get("x-test-token"),
  getImpersonationCookieFromRequest: (req: NextRequest) =>
    req.headers.get("x-test-impersonation"),
}));

const { GET } = await import("./route");

const FLOW_ID = "44444444-4444-4444-4444-444444444444";

const request = (token: string | null = "token"): NextRequest => {
  const headers = new Headers();
  if (token) headers.set("x-test-token", token);
  return new NextRequest(`http://localhost/api/flows/${FLOW_ID}/export`, { headers });
};

const params = Promise.resolve({ id: FLOW_ID });

beforeEach(() => {
  resolveSession.mockReset().mockResolvedValue({ userId: "user-1", isAdmin: false });
  exportExecute.mockReset().mockResolvedValue({
    data: { filename: "procurement-approval-2026-08-17.zip", archive: Buffer.from("zip bytes") },
  });
});

describe("GET /api/flows/[id]/export", () => {
  it("refuses a request with no session token", async () => {
    const response = await GET(request(null), { params });

    expect(response.status).toBe(401);
    expect(exportExecute).not.toHaveBeenCalled();
  });

  it("passes the caller's identity and admin flag to the use-case", async () => {
    resolveSession.mockResolvedValue({ userId: "admin-1", isAdmin: true });

    await GET(request(), { params });

    expect(exportExecute).toHaveBeenCalledWith({
      flowId: FLOW_ID,
      requestedByUserId: "admin-1",
      isAdmin: true,
    });
  });

  it("answers with the archive as a zip attachment named by the use-case", async () => {
    const response = await GET(request(), { params });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toContain(
      "procurement-approval-2026-08-17.zip",
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from("zip bytes"));
  });

  it("keeps the archive out of any shared cache", async () => {
    const response = await GET(request(), { params });

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 403 when the use-case refuses a non-owner, not 500", async () => {
    exportExecute.mockResolvedValue({
      error: { code: "FORBIDDEN", message: "Only the flow's owner or an admin can export it." },
    });

    const response = await GET(request(), { params });

    expect(response.status).toBe(403);
  });

  it("answers 404 for a flow that does not exist", async () => {
    exportExecute.mockResolvedValue({ error: { code: "NOT_FOUND", message: "Flow not found." } });

    const response = await GET(request(), { params });

    expect(response.status).toBe(404);
  });
});
