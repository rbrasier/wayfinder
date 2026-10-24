import type { PermissionKey } from "@wayfinder/domain";
import { describe, expect, it } from "vitest";
import type { AdminArea } from "@/lib/admin-areas";
import {
  gateProfile,
  passesGateWith,
  procedurePaths,
  type ProbeCaller,
} from "./admin-area-gates.probe";

// ADR-066: every procedure an ordinary user cannot reach must be classified here,
// so a new admin procedure cannot ship without someone deciding who may call it.
// The probe only exercises the gate before the resolver, never the resolver.

type ExpectedGate = "global" | AdminArea | readonly AdminArea[] | { readonly permission: PermissionKey };

const technical = "technical";
const users = "users";
const oversight = "oversight";
const global = "global";

const EXPECTED_GATES: Readonly<Record<string, ExpectedGate>> = {
  // Technical — Configuration, Flags, Errors, Schedules, Advanced Flow Settings.
  "error.deleteAll": technical,
  "error.listGrouped": technical,
  "error.listInGroup": technical,
  "error.updateStatus": technical,
  "eventWatch.countNeedingAttention": technical,
  "eventWatch.create": technical,
  "eventWatch.delete": technical,
  "eventWatch.flowOptions": technical,
  "eventWatch.get": technical,
  "eventWatch.list": technical,
  "eventWatch.pause": technical,
  "eventWatch.preview": technical,
  "eventWatch.resume": technical,
  "eventWatch.runNow": technical,
  "eventWatch.runs": technical,
  "eventWatch.test": technical,
  "eventWatch.update": technical,
  "featureFlag.isAdminSurfaceEnabled": technical,
  "featureFlag.list": technical,
  "featureFlag.setRoles": technical,
  "featureFlag.upsert": technical,
  "mcpServer.delete": technical,
  "mcpServer.disable": technical,
  "mcpServer.enable": technical,
  "mcpServer.list": technical,
  "mcpServer.register": technical,
  "mcpServer.test": technical,
  "mcpServer.update": technical,
  "n8n.getWorkflowSchema": technical,
  "n8n.listWorkflows": technical,
  "schedule.listRecentRuns": technical,
  "settings.get": technical,
  "settings.set": technical,
  "settings.getAiConfig": technical,
  "settings.setAiConfig": technical,
  "settings.getDocumentGenerationConfig": technical,
  "settings.setDocumentGenerationConfig": technical,
  "settings.getEmailConfig": technical,
  "settings.setEmailConfig": technical,
  "settings.sendTestEmail": technical,
  "settings.getEmbeddingsConfig": technical,
  "settings.setEmbeddingsConfig": technical,
  "settings.startReindex": technical,
  "settings.reindexStatus": technical,
  "settings.getExtractionConfig": technical,
  "settings.setExtractionConfig": technical,
  "settings.getSessionUploadConfig": technical,
  "settings.setSessionUploadConfig": technical,
  "settings.getStorageConfig": technical,
  "settings.setStorageConfig": technical,
  "settings.getNotificationPrefs": technical,
  "settings.setNotificationPrefs": technical,
  "settings.getN8nConfig": technical,
  "settings.setN8nConfig": technical,
  "settings.getAutomation": technical,
  "settings.setAutomation": technical,
  "settings.testConnectivity": technical,
  "settings.testAllConnectivity": technical,
  "settings.getLoginNotice": technical,
  "settings.setLoginNotice": technical,
  "settings.setAboutLinks": technical,
  "settings.setBranding": technical,
  "settings.setChatDisclaimer": technical,
  "settings.setSiteBanner": technical,
  "skill.archive": technical,
  "skill.create": technical,
  "skill.restore": technical,
  "skill.update": technical,

  // Users — Users, Groups, Organisations, non-admin role assignment.
  "user.create": users,
  "user.delete": users,
  "user.resetPassword": users,
  "user.update": users,
  "group.create": users,
  "group.delete": users,
  "organisation.assignUser": users,
  "organisation.create": users,
  "organisation.delete": users,
  "organisation.getResolution": users,
  "organisation.list": users,
  "organisation.setResolution": users,
  "organisation.update": users,
  "role.assignUser": users,
  "role.listUsers": users,
  "role.removeUser": users,

  // Oversight — dashboards, usage, audit, All Chats, All Flows.
  "analytics.flowDeepDive": oversight,
  "analytics.logInsightsExport": oversight,
  "analytics.value": oversight,
  "audit.export": oversight,
  "audit.getById": oversight,
  "audit.search": oversight,
  "audit.verifyChain": oversight,
  "legalHold.create": oversight,
  "legalHold.list": oversight,
  "legalHold.release": oversight,
  "governance.budgets.create": oversight,
  "governance.budgets.delete": oversight,
  "governance.budgets.list": oversight,
  "governance.budgets.update": oversight,
  "governance.dashboard": oversight,
  "governance.settings.getUsageLimitsEnabled": oversight,
  "governance.settings.setUsageLimitsEnabled": oversight,
  "usage.summary": oversight,
  "session.listAll": oversight,
  "session.listAllPage": oversight,
  "flow.create": { permission: "workflow:create_own" },
  "flow.grantOwner": oversight,
  "flow.list": oversight,

  // Reads shared by more than one area.
  "user.list": [users, oversight],
  "role.list": [users, technical, oversight],

  // Global Admin only — anything that could be used to gain more access.
  "role.create": global,
  "role.delete": global,
  "role.rename": global,
  "role.updatePermissions": global,
  "settings.getAuthConfig": global,
  "settings.setAuthConfig": global,
  "settings.setRegistrationEnabled": global,
  "settings.getDirectoryConfig": global,
  "settings.setDirectoryConfig": global,
  "settings.getSiemConfig": global,
  "settings.setSiemConfig": global,
  "settings.getDeploymentConfig": global,
  "settings.setDeploymentConfig": global,
  "settings.getOnboardingState": global,
  "settings.completeOnboarding": global,
  "settings.getSetupStatus": global,
  "organisation.createForSelf": global,
  "organisation.setEnabled": global,
  "hr.list": global,

  // Gated by an ordinary (non-admin) permission, unchanged by ADR-066.
  "knowledge.edit": { permission: "knowledge:curate" },
  "knowledge.list": { permission: "knowledge:curate" },
  "knowledge.revert": { permission: "knowledge:curate" },
  "knowledge.search": { permission: "knowledge:curate" },
  "knowledge.setStatus": { permission: "knowledge:curate" },
  "knowledge.tag": { permission: "knowledge:curate" },
  "knowledge.versions": { permission: "knowledge:curate" },
  "feedback.list": { permission: "knowledge:curate" },
  "feedback.triage": { permission: "knowledge:curate" },
  "feedback.submit": { permission: "knowledge:submit_feedback" },
};

const ALL_CALLERS: readonly ProbeCaller[] = ["ordinary", "global", "technical", "users", "oversight"];

const expectedProfile = (gate: ExpectedGate): ProbeCaller[] => {
  if (gate === "global" || typeof gate === "object" && "permission" in gate) return ["global"];
  const areas: readonly AdminArea[] = typeof gate === "string" ? [gate] : gate;
  return ALL_CALLERS.filter((caller) => caller === "global" || areas.includes(caller as AdminArea));
};

describe("admin area gates (ADR-066)", () => {
  const paths = procedurePaths();

  it("classifies every procedure an ordinary user is refused", async () => {
    const unclassified: string[] = [];
    for (const path of paths) {
      if (path in EXPECTED_GATES) continue;
      const profile = await gateProfile(path);
      if (!profile.includes("ordinary")) unclassified.push(path);
    }

    expect(unclassified).toEqual([]);
  });

  it("lists no procedure that no longer exists", () => {
    const missing = Object.keys(EXPECTED_GATES).filter((path) => !paths.includes(path));

    expect(missing).toEqual([]);
  });

  it("lets exactly the expected callers through each classified procedure", async () => {
    const mismatches: string[] = [];
    for (const [path, gate] of Object.entries(EXPECTED_GATES)) {
      const actual = await gateProfile(path);
      const expected = expectedProfile(gate);
      if (actual.join(",") !== expected.join(",")) {
        mismatches.push(`${path}: expected ${expected.join(",")} but got ${actual.join(",")}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("lets a holder of the ordinary permission through the procedures gated by it", async () => {
    const refused: string[] = [];
    for (const [path, gate] of Object.entries(EXPECTED_GATES)) {
      if (typeof gate !== "object" || !("permission" in gate)) continue;
      if (!(await passesGateWith(path, [gate.permission]))) refused.push(path);
    }

    expect(refused).toEqual([]);
  });

  it("never opens a Global-only procedure to a delegated admin holding every area key", async () => {
    const opened: string[] = [];
    for (const [path, gate] of Object.entries(EXPECTED_GATES)) {
      if (gate !== "global") continue;
      if (await passesGateWith(path, ["admin:technical", "admin:users", "admin:oversight"])) {
        opened.push(path);
      }
    }

    expect(opened).toEqual([]);
  });
});
