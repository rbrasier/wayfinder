import { beforeEach, describe, expect, it, vi } from "vitest";

// The logo route is the one public door onto object storage (ADR-060 §4), so
// what it will and won't serve is asserted here rather than through a browser.

const { container, state } = vi.hoisted(() => {
  const state = {
    branding: {
      displayName: "",
      primaryColour: null as string | null,
      logo: null as { key: string; mimeType: string; version: number } | null,
    },
    session: null as { sessionId: string; userId: string; isAdmin: boolean } | null,
    stored: new Map<string, Buffer>(),
    uploadResult: null as unknown,
  };
  const container = {
    runtimeConfig: {
      getBrandingConfig: vi.fn(async () => state.branding),
      invalidateBranding: vi.fn(),
    },
    objectStorage: {
      get: vi.fn(async (key: string) => {
        const data = state.stored.get(key);
        return data ? { data } : { error: { code: "NOT_FOUND", message: "missing" } };
      }),
    },
    resolveSession: vi.fn(async () => state.session),
    useCases: {
      uploadBrandingLogo: { execute: vi.fn(async () => state.uploadResult) },
      removeBrandingLogo: { execute: vi.fn(async () => ({ data: { ...state.branding, logo: null } })) },
    },
  };
  return { container, state };
});

vi.mock("@/lib/container", () => ({ getContainer: () => container }));

import { DELETE, GET, POST } from "./route";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const LOGO_KEY = "branding/logo-1727085600000";

const getLogo = (query = ""): Request => new Request(`http://localhost:3000/api/branding/logo${query}`);

const uploadRequest = (file: Blob | null, signedIn = true): Request => {
  const form = new FormData();
  if (file) form.append("file", file, "logo.png");
  return new Request("http://localhost:3000/api/branding/logo", {
    method: "POST",
    headers: signedIn ? { cookie: "better-auth.session_token=token.sig" } : {},
    body: form,
  });
};

describe("GET /api/branding/logo", () => {
  beforeEach(() => {
    state.branding = { displayName: "", primaryColour: null, logo: null };
    state.stored = new Map();
  });

  it("returns 404 when no logo is configured", async () => {
    const response = await GET(getLogo());

    expect(response.status).toBe(404);
  });

  it("serves the configured logo with its stored type and nosniff", async () => {
    state.branding.logo = { key: LOGO_KEY, mimeType: "image/png", version: 1727085600000 };
    state.stored.set(LOGO_KEY, PNG);

    const response = await GET(getLogo("?v=1727085600000"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
  });

  it("caches forever only when the request names the current version", async () => {
    state.branding.logo = { key: LOGO_KEY, mimeType: "image/png", version: 1727085600000 };
    state.stored.set(LOGO_KEY, PNG);

    const versioned = await GET(getLogo("?v=1727085600000"));
    const unversioned = await GET(getLogo());
    const stale = await GET(getLogo("?v=1"));

    expect(versioned.headers.get("cache-control")).toContain("immutable");
    expect(unversioned.headers.get("cache-control")).toBe("no-cache");
    expect(stale.headers.get("cache-control")).toBe("no-cache");
  });

  it("reads the key from config only, ignoring anything the caller asks for", async () => {
    state.branding.logo = { key: LOGO_KEY, mimeType: "image/png", version: 1 };
    state.stored.set(LOGO_KEY, PNG);

    await GET(getLogo("?key=context/flow-1/secret.pdf&v=1"));

    expect(container.objectStorage.get).toHaveBeenLastCalledWith(LOGO_KEY);
  });
});

describe("POST /api/branding/logo", () => {
  beforeEach(() => {
    state.session = { sessionId: "session-1", userId: "admin-1", isAdmin: true };
    state.uploadResult = {
      data: {
        displayName: "",
        primaryColour: null,
        logo: { key: LOGO_KEY, mimeType: "image/png", version: 1727085600000 },
      },
    };
    container.useCases.uploadBrandingLogo.execute.mockClear();
    container.runtimeConfig.invalidateBranding.mockClear();
  });

  it("rejects a signed-out caller", async () => {
    const response = await POST(uploadRequest(new Blob([PNG]), false));

    expect(response.status).toBe(401);
  });

  it("rejects a non-admin", async () => {
    state.session = { sessionId: "session-2", userId: "user-1", isAdmin: false };

    const response = await POST(uploadRequest(new Blob([PNG])));

    expect(response.status).toBe(403);
    expect(container.useCases.uploadBrandingLogo.execute).not.toHaveBeenCalled();
  });

  it("stores the upload and refreshes the cached branding", async () => {
    const response = await POST(uploadRequest(new Blob([PNG])));

    expect(response.status).toBe(200);
    expect(container.useCases.uploadBrandingLogo.execute).toHaveBeenCalledWith(PNG, "admin-1");
    expect(container.runtimeConfig.invalidateBranding).toHaveBeenCalled();
    expect(await response.json()).toEqual({
      displayName: "Wayfinder",
      customDisplayName: "",
      primaryColour: null,
      logoVersion: 1727085600000,
    });
  });

  it("turns a validation failure into a 400 with the reason", async () => {
    state.uploadResult = {
      error: { code: "VALIDATION_FAILED", message: "Use a PNG, JPEG or WebP image. SVG isn't accepted." },
    };

    const response = await POST(uploadRequest(new Blob(["<svg/>"])));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("SVG isn't accepted");
  });

  it("refuses a request with no file", async () => {
    const response = await POST(uploadRequest(null));

    expect(response.status).toBe(400);
  });

  it("refuses an oversized file before reading it", async () => {
    const response = await POST(uploadRequest(new Blob([Buffer.alloc(512 * 1024 + 1)])));

    expect(response.status).toBe(400);
    expect(container.useCases.uploadBrandingLogo.execute).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/branding/logo", () => {
  it("removes the logo for an admin", async () => {
    state.session = { sessionId: "session-1", userId: "admin-1", isAdmin: true };

    const response = await DELETE(
      new Request("http://localhost:3000/api/branding/logo", {
        method: "DELETE",
        headers: { cookie: "better-auth.session_token=token.sig" },
      }),
    );

    expect(response.status).toBe(200);
    expect(container.useCases.removeBrandingLogo.execute).toHaveBeenCalledWith("admin-1");
  });
});
