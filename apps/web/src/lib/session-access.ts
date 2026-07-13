import type { Container } from "./container";

export type SessionAccessOutcome =
  | { authorized: true; readOnly: boolean }
  | { authorized: false; status: 403 | 404 | 500 };

export const accessError = (status: 403 | 404 | 500): string => {
  if (status === 404) return "Session not found";
  if (status === 403) return "Forbidden";
  return "Server error";
};

interface AuthorizeOptions {
  // Write actions (upload, delete, regenerate) require send access; a read-only
  // participant is rejected. Reads pass false so viewers still get the resource.
  requireSend: boolean;
  // Read paths honour the approver grant (ADR-018) so an assigned approver can
  // view the documents they are signing off on without being a stored
  // participant. Write paths pass false — the approver grant is read-only.
  allowApprover: boolean;
}

// Authorises a request against a session's participant membership (scaling wall
// #11), mirroring the chat-stream route. Used by the raw REST routes that serve
// session-scoped uploads and generated documents so that knowing a UUID is not
// itself authorisation.
export const authorizeSessionAccess = async (
  container: Container,
  sessionId: string,
  userId: string,
  isAdmin: boolean,
  options: AuthorizeOptions,
): Promise<SessionAccessOutcome> => {
  const sessionResult = await container.useCases.getSession.execute(sessionId);
  if (sessionResult.error) return { authorized: false, status: 500 };
  if (!sessionResult.data) return { authorized: false, status: 404 };

  const { session, flow } = sessionResult.data;
  const isOwnerOrAdmin = isAdmin || session.userId === userId;
  const isApprover =
    options.allowApprover && !isOwnerOrAdmin
      ? await viewerIsSessionApprover(container, userId, session.id)
      : false;

  const accessResult = await container.useCases.resolveSessionAccess.execute({
    session,
    flow,
    userId,
    isAdmin,
    isApprover,
    allowAutoEnrol: true,
  });
  if (accessResult.error) return { authorized: false, status: 403 };
  if (options.requireSend && !accessResult.data.canSend) {
    return { authorized: false, status: 403 };
  }
  return { authorized: true, readOnly: accessResult.data.readOnly };
};

const viewerIsSessionApprover = async (
  container: Container,
  userId: string,
  sessionId: string,
): Promise<boolean> => {
  const approvalsResult = await container.repos.approvals.listBySession(sessionId);
  if (approvalsResult.error) return false;
  const userResult = await container.repos.users.findById(userId);
  const email = userResult.error ? null : userResult.data?.email ?? null;
  return approvalsResult.data.some(
    (approval) =>
      approval.approverUserId === userId ||
      (email !== null && approval.approverEmail === email),
  );
};
