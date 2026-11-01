import {
  ArchiveSkill,
  CreateSkill,
  DeleteMcpServer,
  DisableMcpServer,
  EnableMcpServer,
  GetSkill,
  ListMcpServers,
  ListMcpServersWithTools,
  ListMcpTools,
  RefreshMcpTools,
  ListSkills,
  RegisterMcpServer,
  ResolveStepSkills,
  ResolveStepTools,
  RestoreSkill,
  RunMcpNode,
  TestMcpServer,
  UpdateMcpServer,
  UpdateMcpToolSettings,
  UpdateSkill,
} from "@wayfinder/application";
import {
  AuditingMcpClient,
  DrizzleMcpCallQueue,
  DrizzleMcpServerRepository,
  DrizzleMcpServerSecretStore,
  DrizzleMcpToolRepository,
  DrizzleSkillRepository,
  McpSdkClient,
  McpServerDirectory,
  McpToolPrepass,
  SkillParser,
  createDatabase,
  type QuotaEnforcer,
  type SettingsEncryptionService,
} from "@wayfinder/adapters";
import type {
  IAuditLogger,
  ILanguageModel,
  ILogger,
  ISessionRepository,
  ISessionStepOutputRepository,
  IUsageRepository,
} from "@wayfinder/domain";

interface SkillsAndMcpDependencies {
  db: ReturnType<typeof createDatabase>;
  usageRepo: IUsageRepository;
  quotaEnforcer: QuotaEnforcer;
  sessions: ISessionRepository;
  languageModel: ILanguageModel;
  sessionStepOutputs: ISessionStepOutputRepository;
  encryption: SettingsEncryptionService;
  auditLogger: IAuditLogger;
  logger: ILogger;
}

// Wiring for the Skills library (ADR-031) and MCP registry/consumption
// (ADR-062), split from container.ts to keep it under the file-size limit.
// The pre-pass carries the usage/quota governance dependencies because it
// calls the model directly rather than through the decorated port. Every MCP
// call goes through the auditing client, so no path calls a tool unrecorded.
export const buildSkillsAndMcp = ({
  db,
  usageRepo,
  quotaEnforcer,
  sessions,
  languageModel,
  sessionStepOutputs,
  encryption,
  auditLogger,
  logger,
}: SkillsAndMcpDependencies) => {
  const skills = new DrizzleSkillRepository(db);
  const skillParser = new SkillParser();
  const mcpServers = new DrizzleMcpServerRepository(db, encryption);
  const mcpServerSecrets = new DrizzleMcpServerSecretStore(db, encryption);
  const mcpTools = new DrizzleMcpToolRepository(db);
  const mcpCallQueue = new DrizzleMcpCallQueue(db);
  const mcpClient = new AuditingMcpClient(new McpSdkClient(mcpServerSecrets), auditLogger, logger);
  const mcpServerDirectory = new McpServerDirectory(mcpServers, mcpClient, mcpTools);
  const mcpToolPrepass = new McpToolPrepass(usageRepo, quotaEnforcer, mcpClient, mcpTools);

  return {
    repos: { skills, mcpServers },
    services: { skillParser, mcpToolPrepass },
    useCases: {
      createSkill: new CreateSkill(skills, skillParser),
      updateSkill: new UpdateSkill(skills, skillParser),
      listSkills: new ListSkills(skills),
      getSkill: new GetSkill(skills),
      archiveSkill: new ArchiveSkill(skills),
      restoreSkill: new RestoreSkill(skills),
      resolveStepSkills: new ResolveStepSkills(skills),
      registerMcpServer: new RegisterMcpServer(mcpServers, mcpServerSecrets),
      updateMcpServer: new UpdateMcpServer(mcpServers, mcpServerSecrets),
      listMcpServers: new ListMcpServers(mcpServers),
      disableMcpServer: new DisableMcpServer(mcpServers),
      enableMcpServer: new EnableMcpServer(mcpServers),
      deleteMcpServer: new DeleteMcpServer(mcpServers),
      testMcpServer: new TestMcpServer(mcpServers, mcpClient, mcpTools),
      refreshMcpTools: new RefreshMcpTools(mcpServers, mcpClient, mcpTools),
      listMcpTools: new ListMcpTools(mcpTools),
      updateMcpToolSettings: new UpdateMcpToolSettings(mcpTools),
      listMcpServersWithTools: new ListMcpServersWithTools(mcpServerDirectory),
      resolveStepTools: new ResolveStepTools(mcpServers),
      runMcpNode: new RunMcpNode(sessions, languageModel, mcpServers, mcpCallQueue, sessionStepOutputs),
    },
  };
};
