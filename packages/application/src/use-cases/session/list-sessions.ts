import type { ISessionRepository, Result, Session } from "@rbrasier/domain";

export class ListSessions {
  constructor(private readonly sessions: ISessionRepository) {}

  async execute(userId: string): Promise<Result<Session[]>> {
    return this.sessions.listByUser(userId);
  }
}
