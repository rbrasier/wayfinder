import {
  ArchiveSkill,
  CreateSkill,
  DeleteMcpServer,
  DisableMcpServer,
  EnableMcpServer,
  GetSkill,
  ListMcpServers,
  ListMcpServersWithTools,
  ListSkills,
  RegisterMcpServer,
  ResolveStepSkills,
  ResolveStepTools,
  RestoreSkill,
  RunMcpNode,
  TestMcpServer,
  UpdateMcpServer,
  UpdateSkill,
} from "@rbrasier/application";
import {
  AiSdkMcpClient,
  DrizzleMcpServerRepository,
  DrizzleSkillRepository,
  McpServerDirectory,
  McpToolPrepass,
  SkillParser,
  createDatabase,
  type QuotaEnforcer,
} from "@rbrasier/adapters";
import type {
  ILanguageModel,
  ISessionRepository,
  ISessionStepOutputRepository,
  IUsageRepository,
} from "@rbrasier/domain";

interface SkillsAndMcpDependencies {
  db: ReturnType<typeof createDatabase>;
  usageRepo: IUsageRepository;
  quotaEnforcer: QuotaEnforcer;
  sessions: ISessionRepository;
  languageModel: ILanguageModel;
  sessionStepOutputs: ISessionStepOutputRepository;
}

// Wiring for the Skills library (ADR-031) and MCP registry/consumption
// (ADR-032), split from container.ts to keep it under the file-size limit.
// The pre-pass carries the usage/quota governance dependencies because it
// calls the model directly rather than through the decorated port.
export const buildSkillsAndMcp = ({
  db,
  usageRepo,
  quotaEnforcer,
  sessions,
  languageModel,
  sessionStepOutputs,
}: SkillsAndMcpDependencies) => {
  const skills = new DrizzleSkillRepository(db);
  const skillParser = new SkillParser();
  const mcpServers = new DrizzleMcpServerRepository(db);
  const mcpClient = new AiSdkMcpClient();
  const mcpServerDirectory = new McpServerDirectory(mcpServers, mcpClient);
  const mcpToolPrepass = new McpToolPrepass(usageRepo, quotaEnforcer);

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
      registerMcpServer: new RegisterMcpServer(mcpServers),
      updateMcpServer: new UpdateMcpServer(mcpServers),
      listMcpServers: new ListMcpServers(mcpServers),
      disableMcpServer: new DisableMcpServer(mcpServers),
      enableMcpServer: new EnableMcpServer(mcpServers),
      deleteMcpServer: new DeleteMcpServer(mcpServers),
      testMcpServer: new TestMcpServer(mcpServers, mcpClient),
      listMcpServersWithTools: new ListMcpServersWithTools(mcpServerDirectory),
      resolveStepTools: new ResolveStepTools(mcpServers),
      runMcpNode: new RunMcpNode(sessions, languageModel, mcpServers, mcpClient, sessionStepOutputs),
    },
  };
};
