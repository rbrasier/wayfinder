import {
  EMAIL_CONFIG_SETTING_KEY,
  domainError,
  err,
  ok,
  type EmailConfig,
  type IEmailSender,
  type ISystemSettingsRepository,
  type Result,
  type SendEmailInput,
} from "@rbrasier/domain";
import nodemailer from "nodemailer";
import {
  buildEnvTransportOptions,
  fetchM365AccessToken,
  type EnvTransportOptions,
  type SmtpEnvConfig,
} from "./smtp-transport";

const M365_SMTP_HOST = "smtp.office365.com";

// Nodemailer tags handshake failures with a short code (EAUTH, ECONNECTION,
// ESOCKET, EDNS, …). Surface that as the reason, never the raw error/credentials.
const smtpVerificationMessage = (cause: unknown): string => {
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.length > 0
    ? `SMTP verification failed (${code})`
    : "SMTP verification failed.";
};

const isConfigComplete = (config: Partial<EmailConfig> | null): config is EmailConfig => {
  if (!config) return false;
  const provider = config.provider ?? "smtp";
  if (provider === "m365") {
    return Boolean(
      config.m365TenantId &&
        config.m365ClientId &&
        config.m365ClientSecret &&
        config.fromAddress,
    );
  }
  return Boolean(
    config.host && config.port && config.username && config.password && config.fromAddress,
  );
};

interface CachedToken {
  value: string;
  expiresAtMs: number;
}

// Refresh slightly early so a token never expires mid-handshake.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export class NodemailerEmailSender implements IEmailSender {
  private m365Token: CachedToken | null = null;

  // When envConfig is provided (SMTP_TRANSPORT_MODE is set) it takes precedence
  // over the admin-settings config — ADR-023 keeps notification credentials in
  // the environment, while deployments without env vars keep using the admin UI.
  constructor(
    private readonly systemSettings: ISystemSettingsRepository,
    private readonly envConfig: SmtpEnvConfig | null = null,
  ) {}

  async send(input: SendEmailInput): Promise<Result<true>> {
    if (this.envConfig) return this.sendViaEnvironment(this.envConfig, input);
    return this.sendViaAdminSettings(input);
  }

  async isConfigured(): Promise<boolean> {
    if (this.envConfig) return this.isEnvConfigComplete(this.envConfig);
    return (await this.loadAdminConfig()) !== null;
  }

  // Live reachability check that never sends a message: an SMTP handshake via
  // transport.verify(), or — for Microsoft 365 — a client-credentials token
  // acquisition. Mirrors send()'s env-over-admin config resolution (ADR-023).
  async testConnectivity(): Promise<Result<true>> {
    if (this.envConfig) return this.verifyEnvironment(this.envConfig);
    return this.verifyAdminSettings();
  }

  private async verifyEnvironment(config: SmtpEnvConfig): Promise<Result<true>> {
    if (config.mode === "stream") {
      return err(
        domainError(
          "VALIDATION_FAILED",
          "Email transport is in stream mode; there is no live endpoint to verify.",
        ),
      );
    }
    if (config.mode === "oauth2") {
      const tokenResult = await this.resolveM365Token(config);
      return tokenResult.error ? tokenResult : ok(true as const);
    }
    const optionsResult = buildEnvTransportOptions(config, null);
    if (optionsResult.error) return optionsResult;
    return this.verifyTransport(this.createTransport(optionsResult.data));
  }

  private async verifyAdminSettings(): Promise<Result<true>> {
    const config = await this.loadAdminConfig();
    if (!config) {
      return err(
        domainError("VALIDATION_FAILED", "Email is not configured. Set email details in admin settings first."),
      );
    }

    if (config.provider === "m365") {
      const mailbox = config.username && config.username.length > 0 ? config.username : config.fromAddress;
      const envShape: SmtpEnvConfig = {
        mode: "oauth2",
        host: M365_SMTP_HOST,
        port: 587,
        secure: false,
        user: mailbox,
        pass: null,
        from: config.fromAddress,
        m365TenantId: config.m365TenantId,
        m365ClientId: config.m365ClientId,
        m365ClientSecret: config.m365ClientSecret,
      };
      const tokenResult = await this.resolveM365Token(envShape);
      return tokenResult.error ? tokenResult : ok(true as const);
    }

    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.username, pass: config.password },
    });
    return this.verifyTransport(transport);
  }

  private async verifyTransport(
    transport: ReturnType<NodemailerEmailSender["createTransport"]>,
  ): Promise<Result<true>> {
    try {
      await transport.verify();
      return ok(true as const);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", smtpVerificationMessage(cause), cause));
    }
  }

  // `stream` mode builds messages but never delivers them, so it does not count
  // as a transport that can actually reach an approver.
  private isEnvConfigComplete(config: SmtpEnvConfig): boolean {
    if (config.mode === "stream") return false;
    if (config.mode === "smtp") {
      return Boolean(config.host && config.user && config.pass && config.from);
    }
    return Boolean(
      config.m365TenantId &&
        config.m365ClientId &&
        config.m365ClientSecret &&
        (config.user || config.from),
    );
  }

  private async sendViaEnvironment(
    config: SmtpEnvConfig,
    input: SendEmailInput,
  ): Promise<Result<true>> {
    if (!config.from) {
      return err(domainError("VALIDATION_FAILED", "SMTP_FROM is required to send email."));
    }

    let accessToken: string | null = null;
    if (config.mode === "oauth2") {
      const tokenResult = await this.resolveM365Token(config);
      if (tokenResult.error) return tokenResult;
      accessToken = tokenResult.data;
    }

    const optionsResult = buildEnvTransportOptions(config, accessToken);
    if (optionsResult.error) return optionsResult;

    return this.deliver(this.createTransport(optionsResult.data), config.from, input);
  }

  private async sendViaAdminSettings(input: SendEmailInput): Promise<Result<true>> {
    const config = await this.loadAdminConfig();
    if (!config) {
      return err(
        domainError("VALIDATION_FAILED", "Email is not configured. Set email details in admin settings first."),
      );
    }

    if (config.provider === "m365") return this.sendViaAdminM365(config, input);

    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.username, pass: config.password },
    });

    const from = config.fromName ? `"${config.fromName}" <${config.fromAddress}>` : config.fromAddress;
    return this.deliver(transport, from, input);
  }

  // Microsoft 365 via Exchange Online: a client-credentials token is fetched and
  // handed to an XOAUTH2 SMTP transport (Basic Auth is being retired on M365).
  private async sendViaAdminM365(config: EmailConfig, input: SendEmailInput): Promise<Result<true>> {
    const mailbox = config.username && config.username.length > 0 ? config.username : config.fromAddress;
    const envShape: SmtpEnvConfig = {
      mode: "oauth2",
      host: M365_SMTP_HOST,
      port: 587,
      secure: false,
      user: mailbox,
      pass: null,
      from: config.fromAddress,
      m365TenantId: config.m365TenantId,
      m365ClientId: config.m365ClientId,
      m365ClientSecret: config.m365ClientSecret,
    };

    const tokenResult = await this.resolveM365Token(envShape);
    if (tokenResult.error) return tokenResult;

    const transport = nodemailer.createTransport({
      host: M365_SMTP_HOST,
      port: 587,
      secure: false,
      auth: { type: "OAuth2", user: mailbox, accessToken: tokenResult.data },
    });

    const from = config.fromName ? `"${config.fromName}" <${config.fromAddress}>` : config.fromAddress;
    return this.deliver(transport, from, input);
  }

  private createTransport(options: EnvTransportOptions) {
    if ("streamTransport" in options) return nodemailer.createTransport(options);
    return nodemailer.createTransport(options);
  }

  private async deliver(
    transport: ReturnType<NodemailerEmailSender["createTransport"]>,
    from: string,
    input: SendEmailInput,
  ): Promise<Result<true>> {
    try {
      await transport.sendMail({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      return ok(true as const);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to send email.", cause));
    }
  }

  private async resolveM365Token(config: SmtpEnvConfig): Promise<Result<string>> {
    if (this.m365Token && this.m365Token.expiresAtMs - TOKEN_EXPIRY_MARGIN_MS > Date.now()) {
      return ok(this.m365Token.value);
    }

    const tokenResult = await fetchM365AccessToken(config, fetch);
    if (tokenResult.error) return tokenResult;

    this.m365Token = {
      value: tokenResult.data.accessToken,
      expiresAtMs: Date.now() + tokenResult.data.expiresInSeconds * 1000,
    };
    return ok(this.m365Token.value);
  }

  private async loadAdminConfig(): Promise<EmailConfig | null> {
    const result = await this.systemSettings.get(EMAIL_CONFIG_SETTING_KEY);
    if (result.error || !result.data) return null;
    try {
      const parsed = JSON.parse(result.data.value) as Partial<EmailConfig>;
      if (!isConfigComplete(parsed)) return null;
      return { ...parsed, provider: parsed.provider ?? "smtp" };
    } catch {
      return null;
    }
  }
}
