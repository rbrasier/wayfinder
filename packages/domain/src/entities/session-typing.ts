// Transient "who is typing now" presence for a collaborative session. Rows are
// heartbeated on a short interval and expire via `expiresAt`; reads ignore
// expired rows. Never part of session reload or the agent checkpoint.
export interface SessionTyping {
  id: string;
  sessionId: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSessionTyping {
  sessionId: string;
  userId: string;
  expiresAt: Date;
}
