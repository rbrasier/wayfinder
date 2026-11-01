import { describe, expect, it } from "vitest";
import { guardOutboundUrl, isBlockedAddress } from "./outbound-url-guard";

const resolvesTo = (...addresses: string[]) => async () => addresses;

describe("isBlockedAddress", () => {
  it("blocks IPv4 loopback", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("127.13.2.9")).toBe(true);
  });

  it("blocks the unspecified address", () => {
    expect(isBlockedAddress("0.0.0.0")).toBe(true);
  });

  it("blocks link-local, including the cloud metadata address", () => {
    expect(isBlockedAddress("169.254.0.1")).toBe(true);
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
  });

  it("blocks every RFC1918 range", () => {
    expect(isBlockedAddress("10.0.0.1")).toBe(true);
    expect(isBlockedAddress("172.16.0.1")).toBe(true);
    expect(isBlockedAddress("172.31.255.255")).toBe(true);
    expect(isBlockedAddress("192.168.1.1")).toBe(true);
  });

  it("allows a public address that merely looks similar", () => {
    expect(isBlockedAddress("172.32.0.1")).toBe(false);
    expect(isBlockedAddress("172.15.255.255")).toBe(false);
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
  });

  it("blocks IPv6 loopback, link-local and unique-local", () => {
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
    expect(isBlockedAddress("fc00::1")).toBe(true);
    expect(isBlockedAddress("fd12:3456::1")).toBe(true);
  });

  it("blocks an IPv4-mapped IPv6 loopback", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("allows a public IPv6 address", () => {
    expect(isBlockedAddress("2606:4700::1111")).toBe(false);
  });
});

describe("guardOutboundUrl", () => {
  it("allows a public HTTPS endpoint", async () => {
    const result = await guardOutboundUrl("https://directory.example.gov/departments", {
      resolveHost: resolvesTo("93.184.216.34"),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.hostname).toBe("directory.example.gov");
  });

  it("rejects plain HTTP", async () => {
    const result = await guardOutboundUrl("http://directory.example.gov/departments", {
      resolveHost: resolvesTo("93.184.216.34"),
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("HTTPS");
  });

  it("rejects a non-HTTP scheme outright", async () => {
    const result = await guardOutboundUrl("file:///etc/passwd", {
      resolveHost: resolvesTo("93.184.216.34"),
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects text that is not a URL", async () => {
    const result = await guardOutboundUrl("not a url", { resolveHost: resolvesTo() });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a literal private address without resolving anything", async () => {
    const result = await guardOutboundUrl("https://10.0.0.5/departments", {
      resolveHost: async () => {
        throw new Error("must not resolve a literal address");
      },
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("internal");
  });

  it("rejects a public name that resolves to a private address", async () => {
    const result = await guardOutboundUrl("https://internal.example.gov/departments", {
      resolveHost: resolvesTo("192.168.10.4"),
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("internal");
  });

  it("rejects a name where only one of several addresses is private", async () => {
    const result = await guardOutboundUrl("https://split.example.gov/departments", {
      resolveHost: resolvesTo("93.184.216.34", "10.1.2.3"),
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a name that resolves to nothing", async () => {
    const result = await guardOutboundUrl("https://missing.example.gov/departments", {
      resolveHost: resolvesTo(),
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("reports a DNS failure as a validation error rather than throwing", async () => {
    const result = await guardOutboundUrl("https://broken.example.gov/departments", {
      resolveHost: async () => {
        throw new Error("ENOTFOUND");
      },
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("allows localhost only when a deployment explicitly opts in", async () => {
    const url = "http://localhost:4010/departments";

    expect((await guardOutboundUrl(url, { resolveHost: resolvesTo("127.0.0.1") })).error).toBeDefined();
    expect(
      (await guardOutboundUrl(url, { allowLocalhost: true, resolveHost: resolvesTo("127.0.0.1") }))
        .error,
    ).toBeUndefined();
  });

  it("does not let the localhost allowance open up other private ranges", async () => {
    const result = await guardOutboundUrl("https://192.168.1.7/departments", {
      allowLocalhost: true,
      resolveHost: resolvesTo("192.168.1.7"),
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});
