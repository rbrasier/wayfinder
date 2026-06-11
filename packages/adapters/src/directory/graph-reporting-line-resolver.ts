import {
  ok,
  type HrColumnMapping,
  type HrRow,
  type IHrDatasetRepository,
  type IReportingLineResolver,
  type IUserRepository,
  type Person,
  type PositionLookupInput,
  type ReportingLineSuggestion,
  type Result,
  type UnresolvedSuggestion,
} from "@rbrasier/domain";
import type { GraphClient, GraphUser } from "./graph-client";

const UNRESOLVED: UnresolvedSuggestion = { unresolved: true };

const headerFor = (mapping: HrColumnMapping, field: string): string | null =>
  Object.entries(mapping).find(([, kind]) => kind === field)?.[0] ?? null;

// Suggests an approver by walking the reporting chain N hops up. Entra (Graph) is
// authoritative; the HR upload's mapped manager column is the fallback. Returns a
// suggestion only — the operator always confirms (ADR-018).
export class GraphReportingLineResolver implements IReportingLineResolver {
  constructor(
    private readonly graph: GraphClient,
    private readonly datasets: IHrDatasetRepository,
    private readonly users: IUserRepository,
  ) {}

  async suggest(input: {
    level: 1 | 2;
    userId: string;
  }): Promise<Result<ReportingLineSuggestion | UnresolvedSuggestion>> {
    const userResult = await this.users.findById(input.userId);
    if (userResult.error) return userResult;
    const email = userResult.data?.email;
    if (!email) return ok(UNRESOLVED);

    const managerEmail = this.graph.isConfigured()
      ? await this.walkGraph(email, input.level)
      : await this.walkHr(email, input.level);
    if (!managerEmail) return ok(UNRESOLVED);

    const managerResult = await this.users.findByEmail(managerEmail);
    if (managerResult.error) return managerResult;
    if (!managerResult.data) return ok(UNRESOLVED);
    return ok({ suggestedApproverUserId: managerResult.data.id });
  }

  async findPositionHolder(input: PositionLookupInput): Promise<Result<Person[]>> {
    const needle = input.role?.trim().toLowerCase();
    if (!needle) return ok([]);

    const rowsResult = await this.datasets.searchRows({ query: needle, limit: 25 });
    if (rowsResult.error) return rowsResult;
    const datasetsResult = await this.datasets.listDatasets();
    if (datasetsResult.error) return datasetsResult;
    const mappingByDataset = new Map<string, HrColumnMapping>(
      datasetsResult.data.map((dataset) => [dataset.id, dataset.columnMapping]),
    );

    const people: Person[] = [];
    for (const row of rowsResult.data) {
      const mapping = mappingByDataset.get(row.datasetId) ?? {};
      if (!this.matchesPosition(row, mapping, input)) continue;
      const person = await this.rowToCandidate(row, mapping);
      if (person) people.push(person);
    }
    return ok(people);
  }

  private matchesPosition(row: HrRow, mapping: HrColumnMapping, input: PositionLookupInput): boolean {
    const positionHeader = headerFor(mapping, "position");
    const position = positionHeader ? (row.data[positionHeader] ?? "").toLowerCase() : "";
    if (input.role && !position.includes(input.role.trim().toLowerCase())) return false;
    if (input.band) {
      const bandHeader = headerFor(mapping, "band");
      const band = bandHeader ? (row.data[bandHeader] ?? "").toLowerCase() : "";
      if (!band.includes(input.band.trim().toLowerCase())) return false;
    }
    if (input.businessUnit) {
      const unitHeader = headerFor(mapping, "unit");
      const unit = unitHeader ? (row.data[unitHeader] ?? "").toLowerCase() : "";
      if (!unit.includes(input.businessUnit.trim().toLowerCase())) return false;
    }
    return true;
  }

  private async rowToCandidate(row: HrRow, mapping: HrColumnMapping): Promise<Person | null> {
    const emailHeader = headerFor(mapping, "email");
    const email = emailHeader ? row.data[emailHeader] : undefined;
    if (!email) return null;
    const nameHeader = headerFor(mapping, "name");
    const positionHeader = headerFor(mapping, "position");
    const accountResult = await this.users.findByEmail(email);
    return {
      source: "hr",
      directoryId: row.id,
      userId: accountResult.error ? null : (accountResult.data?.id ?? null),
      displayName: nameHeader ? row.data[nameHeader] ?? null : null,
      email,
      jobTitle: positionHeader ? row.data[positionHeader] ?? null : null,
      department: null,
    };
  }

  private async walkGraph(email: string, level: 1 | 2): Promise<string | null> {
    let currentRef = encodeURIComponent(email);
    let managerEmail: string | null = null;
    for (let hop = 0; hop < level; hop += 1) {
      const result = await this.graph.get<GraphUser>(`/users/${currentRef}/manager`, {
        $select: "id,mail,userPrincipalName",
      });
      if (result.error) return null;
      const next = result.data.mail ?? result.data.userPrincipalName ?? null;
      if (!next) return null;
      managerEmail = next;
      currentRef = encodeURIComponent(next);
    }
    return managerEmail;
  }

  private async walkHr(email: string, level: 1 | 2): Promise<string | null> {
    let currentEmail: string | null = email;
    let managerEmail: string | null = null;
    for (let hop = 0; hop < level; hop += 1) {
      if (!currentEmail) return null;
      managerEmail = await this.managerOf(currentEmail);
      currentEmail = managerEmail;
    }
    return managerEmail;
  }

  private async managerOf(email: string): Promise<string | null> {
    const rowsResult = await this.datasets.searchRows({ query: email, limit: 10 });
    if (rowsResult.error) return null;
    const datasetsResult = await this.datasets.listDatasets();
    if (datasetsResult.error) return null;
    const mappingByDataset = new Map<string, HrColumnMapping>(
      datasetsResult.data.map((dataset) => [dataset.id, dataset.columnMapping]),
    );
    for (const row of rowsResult.data) {
      const mapping = mappingByDataset.get(row.datasetId) ?? {};
      const emailHeader = headerFor(mapping, "email");
      const managerHeader = headerFor(mapping, "manager");
      if (!emailHeader || !managerHeader) continue;
      if ((row.data[emailHeader] ?? "").toLowerCase() !== email.toLowerCase()) continue;
      const manager = row.data[managerHeader];
      return manager && manager.length > 0 ? manager : null;
    }
    return null;
  }
}
