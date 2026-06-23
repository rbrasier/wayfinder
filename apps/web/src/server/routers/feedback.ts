import { z } from "zod";
import { permissionProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

const reasonSchema = z.enum(["outdated", "wrong", "incomplete", "other"]);

export const feedbackRouter = router({
  // Frontline "Fix This Answer" submission. Deliberately gated by its own key so
  // operators can correct answers without holding full curation rights (ADR-028).
  submit: permissionProcedure("knowledge:submit_feedback")
    .input(
      z.object({
        sessionId: z.string().uuid(),
        messageId: z.string().uuid().nullable(),
        flaggedAnswer: z.string().min(1),
        correctedText: z.string().min(1),
        reason: reasonSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.submitAnswerFeedback.execute({
        sessionId: input.sessionId,
        messageId: input.messageId,
        flaggedAnswer: input.flaggedAnswer,
        correctedText: input.correctedText,
        reason: input.reason,
        createdBy: ctx.userId,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  list: permissionProcedure("knowledge:curate")
    .input(
      z.object({
        status: z.enum(["pending", "accepted", "dismissed"]).nullable().default("pending"),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.listAnswerFeedback.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  triage: permissionProcedure("knowledge:curate")
    .input(
      z.object({
        feedbackId: z.string().uuid(),
        status: z.enum(["accepted", "dismissed"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.triageAnswerFeedback.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
