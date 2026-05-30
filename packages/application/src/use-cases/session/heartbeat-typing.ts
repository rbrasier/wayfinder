import {
  type ISessionTypingRepository,
  type Result,
  type SessionTyping,
} from "@rbrasier/domain";

const DEFAULT_TTL_SECONDS = 5;

export interface HeartbeatTypingInput {
  sessionId: string;
  userId: string;
  ttlSeconds?: number;
}

export class HeartbeatTyping {
  constructor(private readonly sessionTyping: ISessionTypingRepository) {}

  async execute(input: HeartbeatTypingInput): Promise<Result<SessionTyping>> {
    const ttlSeconds = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    return this.sessionTyping.heartbeat({
      sessionId: input.sessionId,
      userId: input.userId,
      expiresAt,
    });
  }
}
