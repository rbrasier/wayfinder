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

const isConfigComplete = (config: Partial<EmailConfig> | null): config is EmailConfig =>
  Boolean(
    config &&
      config.host &&
      config.port &&
      config.username &&
      config.password &&
      config.fromAddress,
  );

export class NodemailerEmailSender implements IEmailSender {
  constructor(private readonly systemSettings: ISystemSettingsRepository) {}

  private async loadConfig(): Promise<EmailConfig | null> {
    const result = await this.systemSettings.get(EMAIL_CONFIG_SETTING_KEY);
    if (result.error || !result.data) return null;
    try {
      const parsed = JSON.parse(result.data.value) as Partial<EmailConfig>;
      return isConfigComplete(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async send(input: SendEmailInput): Promise<Result<true>> {
    const config = await this.loadConfig();
    if (!config) {
      return err(
        domainError("VALIDATION_FAILED", "Email is not configured. Set SMTP details in admin settings first."),
      );
    }

    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.username, pass: config.password },
    });

    const from = config.fromName ? `"${config.fromName}" <${config.fromAddress}>` : config.fromAddress;

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
}
