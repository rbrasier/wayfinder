import nodemailer from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  domainError,
  EMAIL_CONFIG_SETTING_KEY,
  err,
  ok,
  type ISystemSettingsRepository,
  type Result,
  type SystemSetting,
} from "@rbrasier/domain";
import { NodemailerEmailSender } from "./nodemailer-email-sender";
import type { SmtpEnvConfig } from "./smtp-transport";

class FakeSystemSettingsRepository implements ISystemSettingsRepository {
  values = new Map<string, string>();

  async get(key: string): Promise<Result<SystemSetting | null>> {
    const value = this.values.get(key);
    if (value === undefined) return ok(null);
    return ok({ id: key, key, value, createdAt: new Date(0), updatedAt: new Date(0) });
  }

  async set(): Promise<Result<SystemSetting>> {
    return err(domainError("INFRA_FAILURE", "not used"));
  }
  async delete(): Promise<Result<void>> {
    return ok(undefined);
  }
}

const makeEnvConfig = (overrides: Partial<SmtpEnvConfig> = {}): SmtpEnvConfig => ({
  mode: "stream",
  host: null,
  port: null,
  secure: false,
  user: null,
  pass: null,
  from: "noreply@example.com",
  m365TenantId: null,
  m365ClientId: null,
  m365ClientSecret: null,
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NodemailerEmailSender with environment transport config", () => {
  it("sends through the stream sink without touching admin settings", async () => {
    const sender = new NodemailerEmailSender(new FakeSystemSettingsRepository(), makeEnvConfig());

    const result = await sender.send({
      to: "recipient@example.com",
      subject: "Hello",
      text: "Body",
      html: "<p>Body</p>",
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toBe(true);
  });

  it("passes attachments through to the message it sends", async () => {
    const sentMail: Array<Record<string, unknown>> = [];
    const realCreateTransport = nodemailer.createTransport.bind(nodemailer);
    vi.spyOn(nodemailer, "createTransport").mockImplementation(((options: never) => {
      const transport = realCreateTransport(options);
      const realSendMail = transport.sendMail.bind(transport);
      transport.sendMail = ((mail: Record<string, unknown>) => {
        sentMail.push(mail);
        return realSendMail(mail as never);
      }) as typeof transport.sendMail;
      return transport;
    }) as never);
    const sender = new NodemailerEmailSender(new FakeSystemSettingsRepository(), makeEnvConfig());

    const result = await sender.send({
      to: "recipient@example.com",
      subject: "Brief",
      text: "Attached.",
      attachments: [
        {
          filename: "brief.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          content: new Uint8Array([1, 2, 3]),
        },
      ],
    });

    expect(result.error).toBeUndefined();
    expect(sentMail[0]?.attachments).toEqual([
      {
        filename: "brief.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content: Buffer.from([1, 2, 3]),
      },
    ]);
  });

  it("fails when SMTP_FROM is missing", async () => {
    const sender = new NodemailerEmailSender(
      new FakeSystemSettingsRepository(),
      makeEnvConfig({ from: null }),
    );

    const result = await sender.send({ to: "r@example.com", subject: "S", text: "T" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("fails smtp mode when transport variables are incomplete", async () => {
    const sender = new NodemailerEmailSender(
      new FakeSystemSettingsRepository(),
      makeEnvConfig({ mode: "smtp" }),
    );

    const result = await sender.send({ to: "r@example.com", subject: "S", text: "T" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("reports the stream sink as unconfigured since it never delivers", async () => {
    const sender = new NodemailerEmailSender(new FakeSystemSettingsRepository(), makeEnvConfig());

    expect(await sender.isConfigured()).toBe(false);
  });

  it("reports a complete smtp env transport as configured", async () => {
    const sender = new NodemailerEmailSender(
      new FakeSystemSettingsRepository(),
      makeEnvConfig({ mode: "smtp", host: "smtp.example.com", user: "mailer", pass: "secret" }),
    );

    expect(await sender.isConfigured()).toBe(true);
  });

  it("rejects connectivity test in stream mode since there is no live endpoint", async () => {
    const sender = new NodemailerEmailSender(new FakeSystemSettingsRepository(), makeEnvConfig());

    const result = await sender.testConnectivity();

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("stream mode");
  });

  it("acquires an M365 token for an oauth2 env transport and surfaces token failures", async () => {
    const sender = new NodemailerEmailSender(
      new FakeSystemSettingsRepository(),
      makeEnvConfig({
        mode: "oauth2",
        user: "mailer@tenant.com",
        m365TenantId: "tenant-id",
        m365ClientId: "client-id",
        m365ClientSecret: "client-secret",
      }),
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    try {
      const result = await sender.testConnectivity();
      // Reaching the token fetch proves the oauth2 verify branch was taken.
      expect(result.error?.code).toBe("INFRA_FAILURE");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("NodemailerEmailSender without environment transport config", () => {
  it("falls back to admin settings and fails when email is unconfigured", async () => {
    const sender = new NodemailerEmailSender(new FakeSystemSettingsRepository());

    const result = await sender.send({ to: "r@example.com", subject: "S", text: "T" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("not configured");
  });

  it("reports unconfigured when admin settings are empty", async () => {
    const sender = new NodemailerEmailSender(new FakeSystemSettingsRepository());

    expect(await sender.isConfigured()).toBe(false);
  });

  it("reports configured for a complete smtp admin config", async () => {
    const settings = new FakeSystemSettingsRepository();
    settings.values.set(
      EMAIL_CONFIG_SETTING_KEY,
      JSON.stringify({
        provider: "smtp",
        host: "smtp.example.com",
        port: 587,
        username: "mailer",
        password: "secret",
        fromAddress: "noreply@example.com",
      }),
    );
    const sender = new NodemailerEmailSender(settings);

    expect(await sender.isConfigured()).toBe(true);
  });

  it("treats an M365 admin config missing tenant details as unconfigured", async () => {
    const settings = new FakeSystemSettingsRepository();
    settings.values.set(
      EMAIL_CONFIG_SETTING_KEY,
      JSON.stringify({ provider: "m365", fromAddress: "noreply@tenant.com" }),
    );
    const sender = new NodemailerEmailSender(settings);

    const result = await sender.send({ to: "r@example.com", subject: "S", text: "T" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("not configured");
  });

  it("uses the M365 transport for a complete m365 admin config and surfaces token failures", async () => {
    const settings = new FakeSystemSettingsRepository();
    settings.values.set(
      EMAIL_CONFIG_SETTING_KEY,
      JSON.stringify({
        provider: "m365",
        fromAddress: "noreply@tenant.com",
        m365TenantId: "tenant-id",
        m365ClientId: "client-id",
        m365ClientSecret: "client-secret",
      }),
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    try {
      const sender = new NodemailerEmailSender(settings);
      const result = await sender.send({ to: "r@example.com", subject: "S", text: "T" });
      // Reaching the token fetch proves the M365 branch was taken.
      expect(result.error?.code).toBe("INFRA_FAILURE");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
