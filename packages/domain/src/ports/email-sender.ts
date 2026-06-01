import type { Result } from "../result";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface IEmailSender {
  // Resolves the configured transport at send time so admins can update SMTP
  // settings without a restart. Returns a DomainError rather than throwing when
  // email is unconfigured or the transport rejects the message.
  send(input: SendEmailInput): Promise<Result<true>>;
}
