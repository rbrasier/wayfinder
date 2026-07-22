import { analyticsRouter } from "./routers/analytics";
import { approvalRouter } from "./routers/approval";
import { auditRouter } from "./routers/audit";
import { documentRouter } from "./routers/document";
import { errorRouter } from "./routers/error";
import { extractionRouter } from "./routers/extraction";
import { feedbackRouter } from "./routers/feedback";
import { featureFlagRouter } from "./routers/feature-flag";
import { flowRouter } from "./routers/flow";
import { flowVersionRouter } from "./routers/flow-version";
import { governanceRouter } from "./routers/governance";
import { groupRouter } from "./routers/group";
import { hrRouter } from "./routers/hr";
import { knowledgeRouter } from "./routers/knowledge";
import { legalHoldRouter } from "./routers/legal-hold";
import { mcpServerRouter } from "./routers/mcp-server";
import { messageRouter } from "./routers/message";
import { n8nRouter } from "./routers/n8n";
import { organisationRouter } from "./routers/organisation";
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
  extraction: extractionRouter,
  role: roleRouter,
  group: groupRouter,
  organisation: organisationRouter,
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
  mcpServer: mcpServerRouter,
  audit: auditRouter,
  legalHold: legalHoldRouter,
});

export type AppRouter = typeof appRouter;
