import {
  domainError,
  err,
  ok,
  type IEmailSender,
  type Result,
} from "@rbrasier/domain";
import { buildPasswordResetEmail } from "./templates";

export interface SendPasswordResetEmailInput {
  email: string;
  recipientName: string | null;
  resetUrl: string;
  expiryMinutes: number;
}

/**
 * Delivers the self-service password reset link.
 *
 * Driven by the auth provider's reset callback rather than called directly, so
 * the token in `resetUrl` is the provider's own single-use value — this use
 * case composes and sends, and never mints or stores a token itself.
 */
export class SendPasswordResetEmail {
  constructor(private readonly emailSender: IEmailSender) {}

  async execute(input: SendPasswordResetEmailInput): Promise<Result<true>> {
    if (!(await this.emailSender.isConfigured())) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          "Email is not configured, so a password reset link cannot be sent.",
        ),
      );
    }

    const content = buildPasswordResetEmail({
      recipientName: input.recipientName,
      resetUrl: input.resetUrl,
      expiryMinutes: input.expiryMinutes,
    });

    const sent = await this.emailSender.send({
      to: input.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    if (sent.error) return err(sent.error);
    return ok(true);
  }
}
