import type { Person } from "../entities/person";
import type { Result } from "../result";

// Walks the reporting chain N hops up from a user. Returns a *suggestion* only —
// the operator always confirms — or `unresolved` when no chain is available.
export interface ReportingLineSuggestion {
  suggestedApproverUserId: string;
}

export interface UnresolvedSuggestion {
  unresolved: true;
}

export interface PositionLookupInput {
  band?: string;
  role?: string;
  businessUnit?: string;
}

export interface IReportingLineResolver {
  suggest(input: {
    level: 1 | 2;
    userId: string;
  }): Promise<Result<ReportingLineSuggestion | UnresolvedSuggestion>>;
  // The `dynamic` case: who holds the policy-named position. Backed by the same
  // directory sources; returns candidates for the operator to confirm.
  findPositionHolder(input: PositionLookupInput): Promise<Result<Person[]>>;
}
