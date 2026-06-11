import {
  ok,
  type IPeopleDirectory,
  type PeopleSearchInput,
  type Person,
  type Result,
} from "@rbrasier/domain";
import type { GraphClient, GraphUser } from "./graph-client";

export const graphUserToPerson = (user: GraphUser): Person | null => {
  const email = user.mail ?? user.userPrincipalName ?? null;
  if (!email) return null;
  return {
    source: "entra",
    directoryId: user.id,
    userId: null,
    displayName: user.displayName ?? null,
    email,
    jobTitle: user.jobTitle ?? null,
    department: user.department ?? null,
  };
};

// People search over Microsoft Entra via Graph `$search`. When Graph is not
// configured (scopes not yet consented) it returns no results, so resolution
// degrades to the HR upload / manual pick rather than failing (ADR-018).
export class GraphPeopleDirectory implements IPeopleDirectory {
  constructor(private readonly graph: GraphClient) {}

  async search(input: PeopleSearchInput): Promise<Result<Person[]>> {
    if (!this.graph.isConfigured()) return ok([]);

    const escaped = input.query.replaceAll('"', "");
    const result = await this.graph.get<{ value: GraphUser[] }>(
      "/users",
      {
        $search: `"displayName:${escaped}" OR "mail:${escaped}"`,
        $top: String(input.limit),
        $select: "id,displayName,mail,userPrincipalName,jobTitle,department",
      },
      { ConsistencyLevel: "eventual" },
    );
    // A Graph failure degrades to "no Entra results" — the federation layer still
    // returns HR and free-typed candidates.
    if (result.error) return ok([]);

    const people = result.data.value
      .map(graphUserToPerson)
      .filter((person): person is Person => person !== null);
    return ok(people);
  }
}
