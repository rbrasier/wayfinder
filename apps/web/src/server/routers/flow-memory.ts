import { z } from "zod";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

// Every procedure delegates its authorisation to the use case rather than
// duplicating the `canUserEditFlow` check here. A second caller — a job, a
// script, another router — must not be able to reach these unguarded.
export const flowMemoryRouter = router({
  panel: authenticatedProcedure
    .input(z.object({ flowId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getFlowMemoryPanel.execute({
        flowId: input.flowId,
        userId: ctx.userId,
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  lesson: authenticatedProcedure
    .input(z.object({ lessonId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.getLessonDetail.execute({
        lessonId: input.lessonId,
        userId: ctx.userId,
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  accept: authenticatedProcedure
    .input(z.object({ lessonId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.acceptLesson.execute({
        lessonId: input.lessonId,
        userId: ctx.userId,
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),

  reject: authenticatedProcedure
    .input(z.object({ lessonId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.rejectLesson.execute({
        lessonId: input.lessonId,
        userId: ctx.userId,
        isAdmin: ctx.isAdmin,
      });
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
