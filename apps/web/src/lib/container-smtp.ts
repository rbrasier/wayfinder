import type { SmtpEnvConfig } from "@wayfinder/adapters";
import type { ServerEnv } from "./env";

// SMTP_TRANSPORT_MODE set means credentials live in the environment (ADR-023);
// unset means NodemailerEmailSender falls back to the admin-settings config.
export const buildSmtpEnvConfig = (env: ServerEnv): SmtpEnvConfig | null =>
  env.SMTP_TRANSPORT_MODE
    ? {
        mode: env.SMTP_TRANSPORT_MODE,
        host: env.SMTP_HOST ?? null,
        port: env.SMTP_PORT ?? null,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER ?? null,
        pass: env.SMTP_PASS ?? null,
        from: env.SMTP_FROM ?? null,
        m365TenantId: env.M365_TENANT_ID ?? null,
        m365ClientId: env.M365_CLIENT_ID ?? null,
        m365ClientSecret: env.M365_CLIENT_SECRET ?? null,
      }
    : null;
