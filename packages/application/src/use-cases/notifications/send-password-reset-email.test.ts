import { describe, it, expect } from "vitest";
import type { IEmailSender, Result, SendEmailInput } from "@rbrasier/domain";
import { domainError, ok, err } from "@rbrasier/domain";
import { SendPasswordResetEmail } from "./send-password-reset-email";

class RecordingSender implements IEmailSender {
  sent: SendEmailInput[] = [];
  constructor(
    private readonly configured: boolean,
    private readonly result: Result<true> = ok(true),
  ) {}
  async send(input: SendEmailInput): Promise<Result<true>> {
    this.sent.push(input);
    return this.result;
  }
  async isConfigured(): Promise<boolean> {
    return this.configured;
  }
}

const request = {
  email: "ada@example.com",
  recipientName: "Ada Lovelace",
  resetUrl: "https://wayfinder.example/reset-password?token=abc123",
  expiryMinutes: 60,
};

describe("SendPasswordResetEmail", () => {
  it("sends the reset link to the address that asked", async () => {
    const sender = new RecordingSender(true);
    const useCase = new SendPasswordResetEmail(sender);

    const result = await useCase.execute(request);

    expect(result.error).toBeUndefined();
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe("ada@example.com");
    expect(sender.sent[0]?.subject).toBe("Reset your Wayfinder password");
    expect(sender.sent[0]?.text).toContain(request.resetUrl);
    expect(sender.sent[0]?.html).toContain(request.resetUrl);
  });

  // The reset endpoint is only mounted when a sender is wired, so this is a
  // belt-and-braces guard rather than the primary gate.
  it("refuses to send when no transport is configured", async () => {
    const sender = new RecordingSender(false);
    const useCase = new SendPasswordResetEmail(sender);

    const result = await useCase.execute(request);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(sender.sent).toHaveLength(0);
  });

  it("propagates a transport failure rather than reporting success", async () => {
    const sender = new RecordingSender(true, err(domainError("INFRA_FAILURE", "smtp refused")));
    const useCase = new SendPasswordResetEmail(sender);

    const result = await useCase.execute(request);

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("addresses an account with no display name without saying null", async () => {
    const sender = new RecordingSender(true);
    const useCase = new SendPasswordResetEmail(sender);

    await useCase.execute({ ...request, recipientName: null });

    expect(sender.sent[0]?.text).not.toContain("null");
  });
});
