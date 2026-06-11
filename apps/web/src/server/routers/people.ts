import { z } from "zod";
import { authenticatedProcedure, router } from "../trpc";
import { toTrpcError } from "../trpc-errors";

export const peopleRouter = router({
  // Federated "Someone else" search across Entra, the HR upload, and free email.
  search: authenticatedProcedure
    .input(
      z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await ctx.container.useCases.searchPeople.execute(input);
      if (result.error) throw toTrpcError(result.error);
      return result.data;
    }),
});
