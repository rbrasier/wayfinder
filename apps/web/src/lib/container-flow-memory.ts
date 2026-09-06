import {
  AcceptLesson,
  GetFlowMemoryPanel,
  GetLessonDetail,
  GetRetentionSettings,
  RejectLesson,
  SetRetentionWindow,
} from "@rbrasier/application";
import {
  DrizzleFlowLessonRepository,
  DrizzleFlowObservationRepository,
  type Database,
} from "@rbrasier/adapters";
import type {
  IAnalyticsRepository,
  IAnswerFeedbackRepository,
  IAuditLogger,
  IFlowRepository,
  ISystemSettingsRepository,
  RetentionConfig,
} from "@rbrasier/domain";

// The retention windows this deployment's environment sets, used as the fallback
// behind a stored settings row (ADR-041 §2). Every one defaults to 0 — keep
// forever — so an upgrade never starts deleting something a deployment was
// keeping. Read from the same variable names the API service reads.
const retentionDays = (name: string): number => {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
};

export const retentionEnvFallback = (): RetentionConfig => ({
  aiUsageEventsDays: retentionDays("RETENTION_USAGE_EVENTS_DAYS"),
  appSessionMessagesDays: retentionDays("RETENTION_SESSION_MESSAGES_DAYS"),
  coreAuditLogDays: retentionDays("RETENTION_AUDIT_LOG_DAYS"),
  appErrorLogDays: retentionDays("RETENTION_ERROR_LOG_DAYS"),
  appNotificationLogDays: retentionDays("RETENTION_NOTIFICATION_LOG_DAYS"),
  appExtractionRunsDays: retentionDays("RETENTION_EXTRACTION_RUNS_DAYS"),
  aiFlowObservationsDays: retentionDays("RETENTION_FLOW_OBSERVATIONS_DAYS"),
});

export interface FlowMemoryDependencies {
  db: Database;
  flows: IFlowRepository;
  analytics: IAnalyticsRepository;
  answerFeedback: IAnswerFeedbackRepository;
  auditLogger: IAuditLogger;
  systemSettings: ISystemSettingsRepository;
}

// Flow memory (ADR-057) and the retention settings that govern its evidence,
// composed as one unit so the main container stays readable.
export const buildFlowMemory = (dependencies: FlowMemoryDependencies) => {
  const flowObservations = new DrizzleFlowObservationRepository(dependencies.db);
  const flowLessons = new DrizzleFlowLessonRepository(dependencies.db);

  return {
    repos: { flowObservations, flowLessons },
    useCases: {
      getFlowMemoryPanel: new GetFlowMemoryPanel(
        dependencies.flows,
        dependencies.analytics,
        flowLessons,
      ),
      getLessonDetail: new GetLessonDetail(flowLessons, dependencies.flows, flowObservations),
      acceptLesson: new AcceptLesson(
        flowLessons,
        dependencies.flows,
        flowObservations,
        dependencies.answerFeedback,
        dependencies.auditLogger,
      ),
      rejectLesson: new RejectLesson(flowLessons, dependencies.flows, dependencies.auditLogger),
      getRetentionSettings: new GetRetentionSettings(dependencies.systemSettings),
      setRetentionWindow: new SetRetentionWindow(dependencies.systemSettings),
    },
  };
};
