// Environment-driven SMTP transport selection (ADR-023). Three modes:
// `oauth2` (Microsoft 365 / Exchange Online via XOAUTH2 — Basic Auth is being
// retired there), `smtp` (generic relay with username/password), and `stream`
// (a local sink that builds but never delivers messages — the dev/test default).

import { domainError, err, ok, type Result } from "@wayfinder/domain";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type StreamTransport from "nodemailer/lib/stream-transport";

export type SmtpTransportMode = "oauth2" | "smtp" | "stream";

export interface SmtpEnvConfig {
  mode: SmtpTransportMode;
  host: string | null;
  port: number | null;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string | null;
  m365TenantId: string | null;
  m365ClientId: string | null;
  m365ClientSecret: string | null;
}

export type EnvTransportOptions = SMTPTransport.Options | StreamTransport.Options;

const M365_SMTP_HOST = "smtp.office365.com";
const M365_TOKEN_SCOPE = "https://outlook.office365.com/.default";

export const buildEnvTransportOptions = (
  config: SmtpEnvConfig,
  accessToken: string | null,
): Result<EnvTransportOptions> => {
  if (config.mode === "stream") {
    return ok({ streamTransport: true, buffer: true, newline: "unix" });
  }

  if (config.mode === "smtp") {
    if (!config.host || !config.user || !config.pass) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          "SMTP transport mode requires SMTP_HOST, SMTP_USER, and SMTP_PASS.",
        ),
      );
    }
    return ok({
      host: config.host,
      port: config.port ?? 587,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
    });
  }

  const mailbox = config.user ?? config.from;
  if (!mailbox) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "OAuth2 transport mode requires a mailbox via SMTP_USER or SMTP_FROM.",
      ),
    );
  }
  if (!accessToken) {
    return err(
      domainError("VALIDATION_FAILED", "OAuth2 transport mode requires an access token."),
    );
  }
  return ok({
    host: config.host ?? M365_SMTP_HOST,
    port: config.port ?? 587,
    secure: config.secure,
    auth: { type: "OAuth2", user: mailbox, accessToken },
  });
};

export interface M365AccessToken {
  accessToken: string;
  expiresInSeconds: number;
}

// Client-credentials grant against Azure AD. Nodemailer's built-in XOAUTH2
// refresh only supports refresh-token flows, so the token is fetched here and
// handed to the transport directly.
export const fetchM365AccessToken = async (
  config: SmtpEnvConfig,
  fetchImplementation: typeof fetch,
): Promise<Result<M365AccessToken>> => {
  if (!config.m365TenantId || !config.m365ClientId || !config.m365ClientSecret) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        "OAuth2 transport mode requires M365_TENANT_ID, M365_CLIENT_ID, and M365_CLIENT_SECRET.",
      ),
    );
  }

  try {
    const response = await fetchImplementation(
      `https://login.microsoftonline.com/${config.m365TenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: config.m365ClientId,
          client_secret: config.m365ClientSecret,
          scope: M365_TOKEN_SCOPE,
        }).toString(),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return err(
        domainError(
          "INFRA_FAILURE",
          `M365 token request failed with status ${response.status}.`,
          body,
        ),
      );
    }

    const payload = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!payload.access_token) {
      return err(domainError("INFRA_FAILURE", "M365 token response had no access_token."));
    }
    return ok({
      accessToken: payload.access_token,
      expiresInSeconds: payload.expires_in ?? 0,
    });
  } catch (cause) {
    return err(domainError("INFRA_FAILURE", "Failed to fetch an M365 access token.", cause));
  }
};
