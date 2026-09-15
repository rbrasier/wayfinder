import type { SessionEvent } from "@wayfinder/domain";
import type { ResolvedSession } from "@wayfinder/adapters";
import { getContainer, type Container } from "@/lib/container";
import { withPrincipal } from "@/lib/with-principal";

// A long-lived Node connection, never cached or statically rendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirrors the session router: a non-owner approver may watch the session they are
// signing off on, matched by user id or by the email the approval was assigned to
// (ADR-018).
async function isSessionApprover(
  container: Container,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const approvalsResult = await container.repos.approvals.listBySession(sessionId);
  if (approvalsResult.error) return false;
  const userResult = await container.repos.users.findById(userId);
  const email = userResult.error ? null : userResult.data?.email ?? null;
  return approvalsResult.data.some(
    (approval) =>
      approval.approverUserId === userId ||
      (email !== null && approval.approverEmail === email),
  );
}

// Server-Sent Events stream for one session (scaling wall #2). Replaces the 2 s
// typing poll and 3 s session poll: the client opens one EventSource and the
// server pushes turn/message/typing/state events as they happen. Reconnects are
// lossless via Last-Event-ID replay against the message `seq`.
async function handleGET(
  req: Request,
  principal: ResolvedSession,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const container = getContainer();

  const sessionResult = await container.useCases.getSession.execute(sessionId);
  if (sessionResult.error) return new Response("Server error", { status: 500 });
  if (!sessionResult.data) return new Response("Session not found", { status: 404 });
  const { session, flow } = sessionResult.data;

  // Watching is a read; viewers and approvers may subscribe. Authorise against
  // participant rows exactly as the page load does, so a non-visible flow is 403.
  const isOwnerOrAdmin = principal.isAdmin || session.userId === principal.userId;
  const isApprover = isOwnerOrAdmin
    ? false
    : await isSessionApprover(container, principal.userId, session.id);
  const access = await container.useCases.resolveSessionAccess.execute({
    session,
    flow,
    userId: principal.userId,
    isAdmin: principal.isAdmin,
    isApprover,
    allowAutoEnrol: true,
  });
  if (access.error) return new Response("Forbidden", { status: 403 });

  const bus = container.services.sessionEvents;
  const heartbeatMs = container.env.SSE_HEARTBEAT_MS;
  const encoder = new TextEncoder();

  let unsubscribe: (() => Promise<void>) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const cleanup = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (unsubscribe) {
      void unsubscribe();
      unsubscribe = null;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SessionEvent) => {
        // Only message.created advances the durable Last-Event-ID cursor; the
        // rest are transient signals a reconnect re-derives from a state sync.
        const idLine = event.type === "message.created" ? `id: ${event.seq}\n` : "";
        controller.enqueue(
          encoder.encode(`${idLine}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      };
      const trySend = (event: SessionEvent) => {
        try {
          send(event);
        } catch {
          // Controller already closed — abort/cancel handles teardown.
        }
      };

      // Hint EventSource's auto-reconnect delay.
      controller.enqueue(encoder.encode("retry: 3000\n\n"));

      // Lossless reconnect: replay every message the client missed since its last
      // seen seq. A fresh connection (no Last-Event-ID) skips straight to the sync.
      const lastEventId = req.headers.get("last-event-id");
      const lastSeq = lastEventId ? Number.parseInt(lastEventId, 10) : Number.NaN;
      if (Number.isInteger(lastSeq) && lastSeq >= 0) {
        const missed = await container.repos.sessionMessages.listSinceSeq(session.id, lastSeq);
        if (!missed.error) {
          for (const message of missed.data) {
            if (typeof message.seq === "number") trySend({ type: "message.created", seq: message.seq });
          }
        }
      }
      // Nudge one state sync on every (re)connect so the client reconciles.
      trySend({ type: "session.updated" });

      const subscribeResult = await bus.subscribe(session.id, trySend);
      if (subscribeResult.error) {
        controller.close();
        return;
      }
      unsubscribe = subscribeResult.data;

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, heartbeatMs);
    },
    cancel() {
      cleanup();
    },
  });

  req.signal.addEventListener("abort", cleanup);

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Disable proxy buffering (nginx) so events flush immediately.
      "x-accel-buffering": "no",
    },
  });
}

// Resolution and the audit actor scope are one operation, so a route cannot
// obtain a principal without the scope that attributes what it does (ADR-060 §3a).
export const GET = (
  req: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> => withPrincipal(req, (principal) => handleGET(req, principal, context));
