import { describe, expect, it, vi } from "vitest";
import type { ILogger, SiemConfig, SiemEvent } from "@rbrasier/domain";
import { HttpSiemForwarder, type FetchLike } from "./http-siem-forwarder";

const silentLogger: ILogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

const event: SiemEvent = {
  id: "a1",
  actorId: "user-1",
  action: "role.changed",
  resourceType: "user",
  resourceId: "user-2",
  metadata: { from: "member", to: "admin" },
  createdAt: new Date("2026-06-01T12:00:00.000Z"),
  sequence: 1,
};

const config = (overrides: Partial<SiemConfig>): SiemConfig => ({
  enabled: true,
  endpoint: "https://siem.example/ingest",
  format: "json",
  token: "secret-token",
  ...overrides,
});

describe("HttpSiemForwarder", () => {
  it("is a no-op when the SIEM is not configured", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const forwarder = new HttpSiemForwarder(
      async () => config({ enabled: false }),
      silentLogger,
      fetchImpl,
    );

    const result = await forwarder.forward(event);

    expect(result.data).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts to the endpoint with a bearer token when configured", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({ ok: true, status: 200 });
    const forwarder = new HttpSiemForwarder(async () => config({}), silentLogger, fetchImpl);

    const result = await forwarder.forward(event);

    expect(result.data).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://siem.example/ingest");
    expect(init?.headers.authorization).toBe("Bearer secret-token");
    expect(init?.headers["content-type"]).toBe("application/json");
  });

  it("emits CEF when the format is cef", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({ ok: true, status: 200 });
    const forwarder = new HttpSiemForwarder(
      async () => config({ format: "cef" }),
      silentLogger,
      fetchImpl,
    );

    await forwarder.forward(event);

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(init?.body.startsWith("CEF:0|Wayfinder")).toBe(true);
    expect(init?.headers["content-type"]).toBe("text/plain");
  });

  it("fails open when the endpoint returns a non-success status", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({ ok: false, status: 503 });
    const forwarder = new HttpSiemForwarder(async () => config({}), silentLogger, fetchImpl);

    const result = await forwarder.forward(event);

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("fails open when fetch throws", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockRejectedValue(new Error("network down"));
    const forwarder = new HttpSiemForwarder(async () => config({}), silentLogger, fetchImpl);

    const result = await forwarder.forward(event);

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
