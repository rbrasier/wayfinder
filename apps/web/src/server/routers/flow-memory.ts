import { z } from "zod";
import { canOversee, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";
import { featureProcedure } from "../feature-gates";

// Every procedure delegates its authorisation to the use case rather than
// duplicating the `canUserEditFlow` check here. A second caller — a job, a
// script, another router — must not be able to reach these unguarded. The
// use cases' `isAdmin` means "may edit any flow", which oversight grants
// (ADR-066 §4).
const flowMemoryProcedure = featureProcedure("flow_memory");

export const flowMemoryRouter = router({
  panel: flowMemoryProcedure
    .input(z.object({ flowId: z.string().guid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getFlowMemoryPanel.execute({
        flowId: input.flowId,
        userId: ctx.userId,
        isAdmin: canOversee(ctx),
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  lesson: flowMemoryProcedure
    .input(z.object({ lessonId: z.string().guid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getLessonDetail.execute({
        lessonId: input.lessonId,
        userId: ctx.userId,
        isAdmin: canOversee(ctx),
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  accept: flowMemoryProcedure
    .input(z.object({ lessonId: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.acceptLesson.execute({
        lessonId: input.lessonId,
        userId: ctx.userId,
        isAdmin: canOversee(ctx),
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  reject: flowMemoryProcedure
    .input(z.object({ lessonId: z.string().guid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.rejectLesson.execute({
        lessonId: input.lessonId,
        userId: ctx.userId,
        isAdmin: canOversee(ctx),
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
