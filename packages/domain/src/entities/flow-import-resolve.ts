import type { FlowExportDependency, ResolvedFlowDependency } from "./flow-export";
import { isFlowUsableClassification, type McpDataClassification } from "./mcp-server";

// The local records a dependency can match, narrowed to what matching needs.
// The caller lists only what is selectable in a flow — active skills, active
// servers — so an archived or disabled record never silently satisfies an
// import.
export interface DependencyCandidates {
  skills: { id: string; name: string }[];
  servers: { id: string; label: string; dataClassification: McpDataClassification }[];
}

export interface DependencyResolutionOutcome {
  resolved: ResolvedFlowDependency[];
  unresolved: FlowExportDependency[];
  warnings: string[];
}

const describeDependency = (dependency: FlowExportDependency): string =>
  dependency.kind === "skill"
    ? `skill "${dependency.name}"`
    : `MCP tool "${dependency.toolName}" on server "${dependency.name}"`;

// Matches each dependency against this deployment by name, and never by the
// exporting deployment's id — that id means nothing here.
//
// A name matching more than one local record resolves to *nothing*. Neither
// `app_skills.name` nor `admin_mcp_servers.label` carries a unique constraint,
// so this is a real state rather than a contrived one, and picking one (the
// newest, say) would wire a step to the wrong skill or the wrong server in a way
// nobody audits afterwards. The node is flagged instead and the author chooses
// on the canvas (ADR-049 §3).
export const resolveFlowDependencies = (
  dependencies: FlowExportDependency[],
  candidates: DependencyCandidates,
): DependencyResolutionOutcome => {
  const resolved: ResolvedFlowDependency[] = [];
  const unresolved: FlowExportDependency[] = [];
  const warnings: string[] = [];

  for (const dependency of dependencies) {
    if (dependency.kind === "skill") {
      const matches = candidates.skills.filter((skill) => skill.name === dependency.name);

      if (matches.length === 1) {
        resolved.push({ dependency, localId: matches[0]!.id });
        continue;
      }

      if (matches.length > 1) {
        warnings.push(
          `${matches.length} skills here are named "${dependency.name}", so the reference was left unresolved rather than pointed at the wrong one.`,
        );
      }

      unresolved.push(dependency);
      continue;
    }

    const matches = candidates.servers.filter((server) => server.label === dependency.name);

    if (matches.length > 1) {
      warnings.push(
        `${matches.length} MCP servers here are labelled "${dependency.name}", so ${describeDependency(dependency)} was left unresolved rather than pointed at the wrong one.`,
      );
      unresolved.push(dependency);
      continue;
    }

    const server = matches[0];
    if (!server) {
      unresolved.push(dependency);
      continue;
    }

    // A server that sends records out is not selectable in a flow (ADR-062 §1),
    // and `RunMcpNode` refuses one at execution time. Resolving to it would
    // produce a flow that looks complete and fails on the first run.
    if (!isFlowUsableClassification(server.dataClassification)) {
      warnings.push(
        `The server labelled "${dependency.name}" sends records outside Wayfinder and cannot be used in a flow, so ${describeDependency(dependency)} was left unresolved.`,
      );
      unresolved.push(dependency);
      continue;
    }

    resolved.push({ dependency, localId: server.id });
  }

  return { resolved, unresolved, warnings };
};
