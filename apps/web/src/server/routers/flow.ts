import { adminProcedure, router } from "../trpc";

export const flowRouter = router({
  list: adminProcedure.query(async () => {
    return [];
  }),

  get: adminProcedure.query(async () => {
    return null;
  }),
});
