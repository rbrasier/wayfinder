import { analyticsRouter } from "./routers/analytics";
import { errorRouter } from "./routers/error";
import { featureFlagRouter } from "./routers/feature-flag";
import { flowRouter } from "./routers/flow";
import { messageRouter } from "./routers/message";
import { scheduleRouter } from "./routers/schedule";
import { sessionRouter } from "./routers/session";
import { settingsRouter } from "./routers/settings";
import { usageRouter } from "./routers/usage";
import { userRouter } from "./routers/user";
import { router } from "./trpc";

export const appRouter = router({
  user: userRouter,
  error: errorRouter,
  message: messageRouter,
  featureFlag: featureFlagRouter,
  usage: usageRouter,
  flow: flowRouter,
  session: sessionRouter,
  schedule: scheduleRouter,
  settings: settingsRouter,
  analytics: analyticsRouter,
});

export type AppRouter = typeof appRouter;
