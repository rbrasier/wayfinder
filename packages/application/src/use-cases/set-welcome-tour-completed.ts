import {
  type IUserRepository,
  type Result,
  type User,
  domainError,
  err,
} from "@rbrasier/domain";

// The one writer of the welcome-tour stamp (ADR-056 §1): completing the tour
// records when, restarting it clears the record so the gate shows it again.
export class SetWelcomeTourCompleted {
  constructor(private readonly users: IUserRepository) {}

  async execute(userId: string, completed: boolean, now: Date = new Date()): Promise<Result<User>> {
    const found = await this.users.findById(userId);
    if (found.error) return found;
    if (!found.data) {
      return err(domainError("NOT_FOUND", `User ${userId} not found.`));
    }
    return this.users.update(userId, { welcomeTourCompletedAt: completed ? now : null });
  }
}
