import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isFlowDiscoverableBy } from "@rbrasier/domain";
import type { Container } from "@/lib/container";
import { adminProcedure, authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";
import { orderStepIds } from "@/lib/step-order";
import { buildCompletedStepData } from "@/lib/step-data";
import { confirmStep } from "@/app/api/chat/[sessionId]/stream/turn-helpers";

const COMPLETE_CONFIDENCE_THRESHOLD = 90;

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

    const sessions = result.data;
    const flowIds = Array.from(new Set(sessions.map((s) => s.flowId)));

    const flowGraphs = new Map<string, { nodeIds: string[] }>();
    await Promise.all(
      flowIds.map(async (flowId) => {
        const [nodesResult, edgesResult] = await Promise.all([
          ctx.container.repos.flowNodes.listByFlow(flowId),
          ctx.container.repos.flowEdges.listByFlow(flowId),
        ]);
        if (nodesResult.error || edgesResult.error) {
          flowGraphs.set(flowId, { nodeIds: [] });
          return;
        }
        const nodes = nodesResult.data.map((n) => ({ id: n.id, positionX: n.positionX }));
        const edges = edgesResult.data.map((e) => ({ fromNodeId: e.fromNodeId, toNodeId: e.toNodeId }));
        flowGraphs.set(flowId, { nodeIds: orderStepIds(nodes, edges) });
      }),
    );

    const enriched = await Promise.all(
      sessions.map(async (session) => {
        const graph = flowGraphs.get(session.flowId);
        if (!graph || graph.nodeIds.length === 0) return { ...session, lastMessage: null, stepInfo: null };

        const totalSteps = graph.nodeIds.length;
        const currentIndex = session.currentNodeId
          ? graph.nodeIds.indexOf(session.currentNodeId)
          : -1;

        const messagesResult = await ctx.container.repos.sessionMessages.listBySession(session.id);
        const messages = messagesResult.error ? [] : messagesResult.data;

        const lastAssistantMessage = [...messages].reverse().find((m) => m.role === "assistant");
        const lastMessage = lastAssistantMessage?.content ?? null;

        const bestConfidenceByStep = new Map<string, number>();
        for (const message of messages) {
          if (message.role !== "assistant" || !message.stepNodeId || message.confidence === null) continue;
          const previous = bestConfidenceByStep.get(message.stepNodeId) ?? -1;
          if (message.confidence > previous) {
            bestConfidenceByStep.set(message.stepNodeId, message.confidence);
          }
        }

        let completedSteps = 0;
        for (const [nodeId, confidence] of bestConfidenceByStep) {
          if (confidence >= COMPLETE_CONFIDENCE_THRESHOLD && nodeId !== session.currentNodeId) {
            completedSteps++;
          }
        }
        if (session.status === "complete") completedSteps = totalSteps;

        const currentConfidence =
          session.status === "complete"
            ? 0
            : session.currentNodeId
              ? bestConfidenceByStep.get(session.currentNodeId) ?? 0
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
      }),
    );

    return enriched;
  }),

  listAll: adminProcedure.query(async ({ ctx }) => {
    const result = await ctx.container.useCases.listAllSessions.execute();
    if (result.error) throw toTrpcError(result.error);
    return result.data;
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

      // The MCP write action parked on the confirmation gate (Phase B), so the chat
      // can render an editable preview of the tool arguments before Proceed.
      const awaitingNodeId = session.awaitingConfirmationNodeId ?? null;
      const parkedEntry = awaitingNodeId
        ? Object.values(session.pendingExecutions).find(
            (execution) =>
              execution.nodeId === awaitingNodeId &&
              execution.status === "awaiting_confirmation" &&
              Boolean(execution.toolName),
          )
        : undefined;
      const pendingMcpConfirmation = parkedEntry
        ? {
            nodeId: parkedEntry.nodeId,
            toolName: parkedEntry.toolName as string,
            args: parkedEntry.args ?? {},
          }
        : null;

      return { ...result.data, participants, readOnly, pendingMcpConfirmation };
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
    return result.data.filter(
      (f) =>
        f.status === "published" &&
        isFlowDiscoverableBy(f.visibility, {
          ownerUserId: f.ownerUserId,
          viewerUserId: ctx.userId,
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
    .input(
      z.object({
        sessionId: z.string().uuid(),
        // Operator-edited MCP tool arguments (Phase B). Ignored for non-MCP steps.
        mcpArgs: z.record(z.string(), z.unknown()).optional(),
      }),
    )
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
        mcpArgs: input.mcpArgs,
      });
      if (result.error) throw toTrpcError(result.error);
      void ctx.container.services.sessionEvents.publish(input.sessionId, { type: "session.updated" });
      return result.data;
    }),
});
