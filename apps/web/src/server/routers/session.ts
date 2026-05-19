import { publicProcedure, router } from "../trpc";

export const sessionRouter = router({
  list: publicProcedure.query(async () => {
    return [];
  }),

  get: publicProcedure.query(async () => {
    return null;
  }),
});
