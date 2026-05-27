import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isFlowDiscoverableBy } from "@rbrasier/domain";
import { adminProcedure, authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";
import { orderStepIds } from "@/lib/step-order";

const COMPLETE_CONFIDENCE_THRESHOLD = 90;

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

      const { session } = result.data;
      if (!ctx.isAdmin && session.userId !== ctx.userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
      }

      return result.data;
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
      return result.data;
    }),
});
