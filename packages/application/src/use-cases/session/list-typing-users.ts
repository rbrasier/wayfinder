import {
  ok,
  type ISessionTypingRepository,
  type IUserRepository,
  type Result,
} from "@rbrasier/domain";

export interface ListTypingUsersInput {
  sessionId: string;
  excludeUserId?: string;
}

export interface TypingUserView {
  userId: string;
  name: string | null;
}

export class ListTypingUsers {
  constructor(
    private readonly sessionTyping: ISessionTypingRepository,
    private readonly users: IUserRepository,
  ) {}

  async execute(input: ListTypingUsersInput): Promise<Result<TypingUserView[]>> {
    const activeResult = await this.sessionTyping.listActive(input.sessionId);
    if (activeResult.error) return activeResult;

    const others = activeResult.data.filter((row) => row.userId !== input.excludeUserId);

    const views = await Promise.all(
      others.map(async (row) => {
        const userResult = await this.users.findById(row.userId);
        const name = userResult.error ? null : userResult.data?.name ?? null;
        return { userId: row.userId, name };
      }),
    );

    return ok(views);
  }
}
