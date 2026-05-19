import type { ISessionRepository, Result, Session } from "@rbrasier/domain";

export class ListAllSessions {
  constructor(private readonly sessions: ISessionRepository) {}

  async execute(): Promise<Result<Session[]>> {
    return this.sessions.listAll();
  }
}
