import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { groupIdsForMemberships, isFlowDiscoverableBy } from "@rbrasier/domain";
import type { Session, SessionListSummary } from "@rbrasier/domain";
import type { Container } from "@/lib/container";
import { adminProcedure, authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";
import { orderStepIds } from "@/lib/step-order";
import { buildCompletedStepData } from "@/lib/step-data";
import { confirmStep } from "@/lib/chat/confirm-step";

const COMPLETE_CONFIDENCE_THRESHOLD = 90;

// Maps each of the given user ids to their organisation id (or omits them when
// unaffiliated), in a single batch lookup. Backs the `organisation` visibility
// owner-join (ADR-038) without a per-flow query or a denormalised column.
const resolveOwnerOrganisations = async (
  container: Container,
  ownerUserIds: string[],
  viewerUserId: string,
): Promise<Map<string, string | null>> => {
  const uniqueIds = [...new Set([...ownerUserIds, viewerUserId])];
  const map = new Map<string, string | null>();
  if (uniqueIds.length === 0) return map;
  const usersResult = await container.repos.users.findByIds(uniqueIds);
  if (usersResult.error) return map;
  for (const user of usersResult.data) {
    map.set(user.id, user.organisationId);
  }
  return map;
};

// Keyset page request for the paginated list endpoints. `limit` is clamped to a
// sane range here; the adapter clamps again to a hard maximum. `cursor` is the
// opaque `nextCursor` from the previous page — null/absent means the first page.
export const sessionListPageInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().nullish(),
});

export type SessionListEntry = Session & {
  lastMessage: string | null;
  stepInfo: {
    currentIndex: number;
    totalSteps: number;
    completedSteps: number;
    currentConfidence: number;
  } | null;
};

// Pure list-row shaping shared by `list` and `listPage`: given a session, its
// flow's ordered node ids, and the pre-aggregated message summary, derive the
// step progress the card renders. Kept side-effect-free so both the full-list
// and paginated procedures produce identical rows.
export function buildSessionListEntry(
  session: Session,
  graph: { nodeIds: string[] } | undefined,
  summary: SessionListSummary | undefined,
): SessionListEntry {
  if (!graph || graph.nodeIds.length === 0) {
    return { ...session, lastMessage: null, stepInfo: null };
  }

  const totalSteps = graph.nodeIds.length;
  const currentIndex = session.currentNodeId ? graph.nodeIds.indexOf(session.currentNodeId) : -1;

  const lastMessage = summary?.lastAssistantContent ?? null;
  const bestConfidenceByStep = summary?.bestConfidenceByStep ?? {};

  let completedSteps = 0;
  for (const [nodeId, confidence] of Object.entries(bestConfidenceByStep)) {
    if (confidence >= COMPLETE_CONFIDENCE_THRESHOLD && nodeId !== session.currentNodeId) {
      completedSteps++;
    }
  }
  if (session.status === "complete") completedSteps = totalSteps;

  const currentConfidence =
    session.status === "complete"
      ? 0
      : session.currentNodeId
        ? bestConfidenceByStep[session.currentNodeId] ?? 0
        : 0;

  return {
    ...session,
    lastMessage,
    stepInfo: {
      currentIndex: currentIndex >= 0 ? currentIndex + 1 : 0,
      totalSteps,
      completedSteps,
      currentConfidence,
    },
  };
}

// Enriches a batch of sessions with per-flow step ordering and per-session
// message summaries in a fixed number of queries, regardless of batch size
// (scaling wall #1). Shared by the full-list and paginated procedures.
async function enrichSessions(
  container: Container,
  sessions: Session[],
): Promise<SessionListEntry[]> {
  const flowIds = Array.from(new Set(sessions.map((session) => session.flowId)));

  const flowGraphs = new Map<string, { nodeIds: string[] }>();
  await Promise.all(
    flowIds.map(async (flowId) => {
      const [nodesResult, edgesResult] = await Promise.all([
        container.repos.flowNodes.listByFlow(flowId),
        container.repos.flowEdges.listByFlow(flowId),
      ]);
      if (nodesResult.error || edgesResult.error) {
        flowGraphs.set(flowId, { nodeIds: [] });
        return;
      }
      const nodes = nodesResult.data.map((node) => ({ id: node.id, positionX: node.positionX }));
      const edges = edgesResult.data.map((edge) => ({
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
      }));
      flowGraphs.set(flowId, { nodeIds: orderStepIds(nodes, edges) });
    }),
  );

  const summariesResult = await container.repos.sessionMessages.summariseForSessionList(
    sessions.map((session) => session.id),
  );
  const summaryBySession = new Map(
    (summariesResult.error ? [] : summariesResult.data).map(
      (summary) => [summary.sessionId, summary] as const,
    ),
  );

  return sessions.map((session) =>
    buildSessionListEntry(session, flowGraphs.get(session.flowId), summaryBySession.get(session.id)),
  );
}

// An approver who is not the session owner may still open the session read-only
// to see what they are signing off on. Matches by user id and by email so an
// approval assigned before the recipient had an account is honoured (ADR-018).
async function viewerIsSessionApprover(
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

export const sessionRouter = router({
  list: authenticatedProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listSessions.execute(ctx.userId);
    if (result.error) throw toTrpcError(result.error);
    return enrichSessions(ctx.container, result.data);
  }),

  // Keyset-paginated counterpart of `list`. Same enriched rows, one page at a
  // time; the client threads `nextCursor` back to fetch older sessions. Additive
  // — `list` stays for callers that want the whole set.
  listPage: authenticatedProcedure
    .input(sessionListPageInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.listSessionsPage.execute(ctx.userId, {
        limit: input.limit,
        cursor: input.cursor ?? undefined,
      });
      if (result.error) throw toTrpcError(result.error);
      const items = await enrichSessions(ctx.container, result.data.items);
      return { items, nextCursor: result.data.nextCursor };
    }),

  listAll: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listAllSessions.execute();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
  }),

  // Keyset-paginated counterpart of `listAll` for the admin table. Returns bare
  // sessions (the admin view joins users/flows client-side), one page at a time.
  listAllPage: adminProcedure
    .input(sessionListPageInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.listAllSessionsPage.execute({
        limit: input.limit,
        cursor: input.cursor ?? undefined,
      });
      if (result.error) throw toTrpcError(result.error);
      return { items: result.data.items, nextCursor: result.data.nextCursor };
    }),

  get: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getSession.execute(input.sessionId);
      if (result.error) throw toTrpcError(result.error);
      if (!result.data) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });

      const { session, flow, messages } = result.data;

      // Authorise against participant rows, not knowledge of the URL (scaling
      // wall #11). Opening the collaborate link auto-enrols a flow-visible
      // visitor as a collaborator; the server-computed role — not ?shared=true —
      // decides read-only. The approver read grant (ADR-018) is only computed for
      // non-owners so owners never pay the approvals lookup on a poll.
      const isOwnerOrAdmin = ctx.isAdmin || session.userId === ctx.userId;
      const isApprover = isOwnerOrAdmin
        ? false
        : await viewerIsSessionApprover(ctx.container, ctx.userId, session.id);
      const accessResult = await ctx.container.useCases.resolveSessionAccess.execute({
        session,
        flow,
        userId: ctx.userId,
        isAdmin: ctx.isAdmin,
        isApprover,
        allowAutoEnrol: true,
      });
      if (accessResult.error) throw toTrpcError(accessResult.error);
      const readOnly = accessResult.data.readOnly;

      const senderIds = new Set<string>([session.userId]);
      for (const message of messages) {
        if (message.senderUserId) senderIds.add(message.senderUserId);
      }
      // One IN query instead of one findById per participant per poll
      // (scaling wall #6).
      const usersResult = await ctx.container.repos.users.findByIds([...senderIds]);
      const namesById = new Map(
        (usersResult.error ? [] : usersResult.data).map((user) => [user.id, user.name] as const),
      );
      const participants = [...senderIds].map((id) => ({
        id,
        name: namesById.get(id) ?? null,
      }));

      return { ...result.data, participants, readOnly };
    }),

  revokeParticipant: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid(), participantUserId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sessionResult = await ctx.container.useCases.getSession.execute(input.sessionId);
      if (sessionResult.error) throw toTrpcError(sessionResult.error);
      if (!sessionResult.data) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      // Only the session owner or an admin may revoke a collaborator's send
      // access; the revoke downgrades them to viewer so their next send is 403.
      if (!ctx.isAdmin && sessionResult.data.session.userId !== ctx.userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
      }
      const result = await ctx.container.useCases.revokeSessionParticipant.execute({
        sessionId: input.sessionId,
        participantUserId: input.participantUserId,
        revokedByUserId: ctx.userId,
      });
      if (result.error) throw toTrpcError(result.error);
      void ctx.container.services.sessionEvents.publish(input.sessionId, { type: "session.updated" });
      return { ok: true as const };
    }),

  stepData: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getSession.execute(input.sessionId);
      if (result.error) throw toTrpcError(result.error);
      if (!result.data) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });

      const { session, messages, nodes, edges } = result.data;
      if (!ctx.isAdmin && session.userId !== ctx.userId) {
        const isApprover = await viewerIsSessionApprover(ctx.container, ctx.userId, session.id);
        if (!isApprover) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
        }
      }

      const outputsResult = await ctx.container.repos.sessionStepOutputs.listBySession(input.sessionId);
      const outputs = outputsResult.error ? [] : outputsResult.data;

      return buildCompletedStepData({
        currentNodeId: session.currentNodeId,
        messages,
        nodes,
        edges,
        outputs,
      });
    }),

  // Ephemeral typing presence over the event bus (scaling wall #2): no DB row,
  // no heartbeat poll. Each keystroke burst publishes a transient `typing` event
  // that every other open window's EventSource receives. The name is resolved
  // client-side from the participant list.
  emitTyping: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.container.services.sessionEvents.publish(input.sessionId, {
        type: "typing",
        userId: ctx.userId,
        userName: null,
      });
      return { ok: true as const };
    }),

  create: authenticatedProcedure
    .input(z.object({ flowId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.startSession.execute({
        flowId: input.flowId,
        userId: ctx.userId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  listPublishedFlows: authenticatedProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listFlows.execute();
    if (result.error) throw toTrpcError(result.error);
    // Resolve the viewer's groups per request so a group-visible flow appears the
    // moment they join and disappears the moment they are removed (ADR-036).
    const groupContext = await ctx.container.useCases.resolveGroupAuthorization.execute(
      ctx.userId,
      ctx.isAdmin,
    );
    const viewerGroupIds = groupContext.error
      ? []
      : groupIdsForMemberships(groupContext.data.memberships);

    const published = result.data.filter((f) => f.status === "published");
    // Resolve the viewer's and each owner's organisation (the owner-join,
    // ADR-038) so an organisation-visible flow is discoverable exactly to users
    // who share its owner's organisation. Batched into one user lookup.
    const ownerOrganisationById = await resolveOwnerOrganisations(
      ctx.container,
      published.map((f) => f.ownerUserId),
      ctx.userId,
    );
    const viewerOrganisationId = ownerOrganisationById.get(ctx.userId) ?? null;

    return published.filter((f) =>
      isFlowDiscoverableBy(f.visibility, {
        ownerUserId: f.ownerUserId,
        viewerUserId: ctx.userId,
        viewerGroupIds,
        ownerOrganisationId: ownerOrganisationById.get(f.ownerUserId) ?? null,
        viewerOrganisationId,
        viewerIsAdmin: ctx.isAdmin,
      }),
    );
  }),

  rename: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid(), title: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const sessionResult = await ctx.container.useCases.getSession.execute(input.sessionId);
      if (sessionResult.error) throw toTrpcError(sessionResult.error);
      if (!sessionResult.data) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      if (!ctx.isAdmin && sessionResult.data.session.userId !== ctx.userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
      }
      const result = await ctx.container.repos.sessions.update(input.sessionId, { title: input.title });
      if (result.error) throw toTrpcError(result.error);
      void ctx.container.services.sessionEvents.publish(input.sessionId, { type: "session.updated" });
      return result.data;
    }),

  close: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sessionResult = await ctx.container.useCases.getSession.execute(input.sessionId);
      if (sessionResult.error) throw toTrpcError(sessionResult.error);
      if (!sessionResult.data) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      if (!ctx.isAdmin && sessionResult.data.session.userId !== ctx.userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
      }
      const result = await ctx.container.repos.sessions.update(input.sessionId, { status: "abandoned" });
      if (result.error) throw toTrpcError(result.error);
      void ctx.container.services.sessionEvents.publish(input.sessionId, { type: "session.updated" });
      return result.data;
    }),

  overrideBranch: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid(), targetNodeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sessionResult = await ctx.container.useCases.getSession.execute(input.sessionId);
      if (sessionResult.error) throw toTrpcError(sessionResult.error);
      if (!sessionResult.data) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      if (!ctx.isAdmin && sessionResult.data.session.userId !== ctx.userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
      }
      const result = await ctx.container.useCases.overrideBranch.execute({
        sessionId: input.sessionId,
        targetNodeId: input.targetNodeId,
      });
      if (result.error) throw toTrpcError(result.error);
      void ctx.container.services.sessionEvents.publish(input.sessionId, { type: "session.updated" });
      return result.data;
    }),

  confirmStep: authenticatedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sessionResult = await ctx.container.useCases.getSession.execute(input.sessionId);
      if (sessionResult.error) throw toTrpcError(sessionResult.error);
      if (!sessionResult.data) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });

      const { session, flow, nodes, edges, messages } = sessionResult.data;
      // Only the originator (or an admin) may confirm — this rejects read-only
      // shared participants, mirroring overrideBranch's authorisation.
      if (!ctx.isAdmin && session.userId !== ctx.userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
      }

      const result = await confirmStep({
        container: ctx.container,
        session,
        flow,
        nodes,
        edges,
        messages,
        confirmedByUserId: ctx.userId,
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      void ctx.container.services.sessionEvents.publish(input.sessionId, { type: "session.updated" });
      return result.data;
    }),
});
