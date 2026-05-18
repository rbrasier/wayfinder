import { errorRouter } from "./routers/error";
import { featureFlagRouter } from "./routers/feature-flag";
import { messageRouter } from "./routers/message";
import { usageRouter } from "./routers/usage";
import { userRouter } from "./routers/user";
import { router } from "./trpc";

export const appRouter = router({
  user: userRouter,
  error: errorRouter,
  message: messageRouter,
  featureFlag: featureFlagRouter,
  usage: usageRouter,
});

export type AppRouter = typeof appRouter;
