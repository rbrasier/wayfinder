import type {
  ISessionRepository,
  Result,
  Session,
  SessionListPage,
  SessionListPageOptions,
} from "@rbrasier/domain";

// Keyset-paginated variant of ListSessions. Additive: existing callers keep
// using ListSessions; adopters of pagination call this one and thread the
// `nextCursor` back on subsequent pages. Server-side support for phase Group A
// item 4 — the client is free to migrate at its own pace.
export class ListSessionsPage {
  constructor(private readonly sessions: ISessionRepository) {}

  execute(
    userId: string,
    options: SessionListPageOptions,
  ): Promise<Result<SessionListPage<Session>>> {
    return this.sessions.listByUserPage(userId, options);
  }
}
