import { FLOW_ARCHIVE_LIMITS } from "@wayfinder/domain";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveSession = vi.fn();
const inspectExecute = vi.fn();
const importExecute = vi.fn();

vi.mock("@/lib/container", () => ({
  getContainer: () => ({
    resolveSession,
    useCases: {
      inspectFlowImport: { execute: inspectExecute },
      importFlow: { execute: importExecute },
    },
  }),
}));

vi.mock("@/lib/session-token", () => ({
  getSessionTokenFromRequest: (req: NextRequest) => req.headers.get("x-test-token"),
}));

const { POST } = await import("./route");

const requestWith = (
  parts: { file?: Blob; filename?: string; mode?: string },
  token: string | null = "token",
): NextRequest => {
  const body = new FormData();
  if (parts.file) body.set("file", parts.file, parts.filename ?? "flow.zip");
  if (parts.mode) body.set("mode", parts.mode);

  const headers = new Headers();
  if (token) headers.set("x-test-token", token);

  return new NextRequest("http://localhost/api/flows/import", { method: "POST", body, headers });
};

const smallArchive = (): Blob => new Blob([new Uint8Array([1, 2, 3])], { type: "application/zip" });

beforeEach(() => {
  resolveSession.mockReset().mockResolvedValue({ userId: "user-1", isAdmin: false });
  inspectExecute.mockReset().mockResolvedValue({ data: { manifest: {}, resolved: [], unresolved: [], assetCount: 0, warnings: [] } });
  importExecute.mockReset().mockResolvedValue({
    data: { flow: { id: "flow-9", name: "Imported" }, unresolved: [], warnings: [] },
  });
});

describe("POST /api/flows/import — authentication", () => {
  it("refuses a request with no session token", async () => {
    const response = await POST(requestWith({ file: smallArchive(), mode: "inspect" }, null));

    expect(response.status).toBe(401);
    expect(inspectExecute).not.toHaveBeenCalled();
  });

  it("refuses a token that resolves to no session", async () => {
    resolveSession.mockResolvedValue(null);

    const response = await POST(requestWith({ file: smallArchive(), mode: "inspect" }));

    expect(response.status).toBe(401);
    expect(inspectExecute).not.toHaveBeenCalled();
  });
});

describe("POST /api/flows/import — request shape", () => {
  it("rejects a request with no file", async () => {
    const response = await POST(requestWith({ mode: "inspect" }));

    expect(response.status).toBe(400);
    expect(inspectExecute).not.toHaveBeenCalled();
  });

  it("rejects an unknown mode rather than guessing which half was meant", async () => {
    const response = await POST(requestWith({ file: smallArchive(), mode: "commit-please" }));

    expect(response.status).toBe(400);
    expect(importExecute).not.toHaveBeenCalled();
  });
});

describe("POST /api/flows/import — size ceiling", () => {
  it("rejects an oversized archive before the reader is called at all", async () => {
    const oversized = new Blob([new Uint8Array(FLOW_ARCHIVE_LIMITS.maxArchiveBytes + 1)]);

    const response = await POST(requestWith({ file: oversized, mode: "inspect" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("MB") });
    expect(inspectExecute).not.toHaveBeenCalled();
  });
});

describe("POST /api/flows/import — inspect", () => {
  it("returns the inspection without importing anything", async () => {
    const response = await POST(requestWith({ file: smallArchive(), mode: "inspect" }));

    expect(response.status).toBe(200);
    expect(inspectExecute).toHaveBeenCalledTimes(1);
    expect(importExecute).not.toHaveBeenCalled();
  });

  it("maps a refused archive to 400 rather than a server error", async () => {
    inspectExecute.mockResolvedValue({
      error: { code: "VALIDATION_FAILED", message: "The uploaded archive is not a readable zip file." },
    });

    const response = await POST(requestWith({ file: smallArchive(), mode: "inspect" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("zip") });
  });
});

describe("POST /api/flows/import — commit", () => {
  it("imports as the signed-in user and answers 201", async () => {
    const response = await POST(requestWith({ file: smallArchive(), mode: "commit" }));

    expect(response.status).toBe(201);
    expect(importExecute).toHaveBeenCalledWith(
      expect.objectContaining({ importedByUserId: "user-1" }),
    );
    expect(await response.json()).toMatchObject({ flowId: "flow-9" });
  });

  it("passes unresolved dependencies back so the client can warn about them", async () => {
    importExecute.mockResolvedValue({
      data: {
        flow: { id: "flow-9", name: "Imported" },
        unresolved: [{ kind: "skill", sourceId: "s", name: "Procurement Policy", nodeIds: ["n"] }],
        warnings: ["two skills share that name"],
      },
    });

    const response = await POST(requestWith({ file: smallArchive(), mode: "commit" }));
    const body = await response.json();

    expect(body.unresolved).toHaveLength(1);
    expect(body.warnings).toHaveLength(1);
  });
});
