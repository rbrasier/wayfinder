import { analyticsRouter } from "./routers/analytics";
import { approvalRouter } from "./routers/approval";
import { documentRouter } from "./routers/document";
import { errorRouter } from "./routers/error";
import { feedbackRouter } from "./routers/feedback";
import { featureFlagRouter } from "./routers/feature-flag";
import { flowRouter } from "./routers/flow";
import { flowVersionRouter } from "./routers/flow-version";
import { governanceRouter } from "./routers/governance";
import { hrRouter } from "./routers/hr";
import { knowledgeRouter } from "./routers/knowledge";
import { messageRouter } from "./routers/message";
import { n8nRouter } from "./routers/n8n";
import { peopleRouter } from "./routers/people";
import { roleRouter } from "./routers/role";
import { scheduleRouter } from "./routers/schedule";
import { sessionRouter } from "./routers/session";
import { settingsRouter } from "./routers/settings";
import { skillRouter } from "./routers/skill";
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
  flowVersion: flowVersionRouter,
  role: roleRouter,
  session: sessionRouter,
  schedule: scheduleRouter,
  settings: settingsRouter,
  n8n: n8nRouter,
  analytics: analyticsRouter,
  governance: governanceRouter,
  approval: approvalRouter,
  document: documentRouter,
  people: peopleRouter,
  hr: hrRouter,
  knowledge: knowledgeRouter,
  feedback: feedbackRouter,
  skill: skillRouter,
});

export type AppRouter = typeof appRouter;
