import type {
  ISessionRepository,
  Result,
  Session,
  SessionListPage,
  SessionListPageOptions,
} from "@rbrasier/domain";

// Admin counterpart of ListSessionsPage.
export class ListAllSessionsPage {
  constructor(private readonly sessions: ISessionRepository) {}

  execute(options: SessionListPageOptions): Promise<Result<SessionListPage<Session>>> {
    return this.sessions.listAllPage(options);
  }
}
