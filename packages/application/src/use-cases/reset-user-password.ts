import {
  MINIMUM_PASSWORD_LENGTH,
  type IAuditLogger,
  type IPasswordResetter,
  type IUserRepository,
  type PasswordResetOutcome,
  type Result,
  domainError,
  err,
  ok,
} from "@rbrasier/domain";

export const RESET_PASSWORD_AUDIT_ACTION = "admin.user.password_reset";

export interface ResetUserPasswordCommand {
  // The administrator performing the reset, recorded so the audit trail names a
  // person rather than the system. Nullable because the admin guard checks
  // `isAdmin` without narrowing the session's user id; `NewAuditLog` already
  // models an unknown actor the same way.
  readonly actorId: string | null;
  readonly userId: string;
  readonly password: string;
}

/**
 * Administrator-initiated password reset for another user.
 *
 * The audit entry is written only after the credential is actually replaced, so
 * the trail never claims a reset that did not happen. It records the target's
 * address and how many sessions the reset ended — never the password itself.
 */
export class ResetUserPassword {
  constructor(
    private readonly users: IUserRepository,
    private readonly passwordResetter: IPasswordResetter,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async execute(command: ResetUserPasswordCommand): Promise<Result<PasswordResetOutcome>> {
    if (command.password.length < MINIMUM_PASSWORD_LENGTH) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `A password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
        ),
      );
    }

    const found = await this.users.findById(command.userId);
    if (found.error) return err(found.error);
    if (!found.data) {
      return err(domainError("NOT_FOUND", `User ${command.userId} not found.`));
    }

    const reset = await this.passwordResetter.resetPassword({
      userId: command.userId,
      password: command.password,
    });
    if (reset.error) return err(reset.error);

    await this.auditLogger.log({
      actorId: command.actorId,
      action: RESET_PASSWORD_AUDIT_ACTION,
      resourceType: "user",
      resourceId: command.userId,
      metadata: { email: found.data.email, sessionsRevoked: reset.data.sessionsRevoked },
    });

    return ok(reset.data);
  }
}
