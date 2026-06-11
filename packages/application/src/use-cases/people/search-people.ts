import {
  ok,
  type IPeopleDirectory,
  type PeopleSearchInput,
  type Person,
  type Result,
} from "@rbrasier/domain";
import { appendTypedEmail, mergePeople } from "./merge-people";

export class SearchPeople {
  constructor(private readonly directories: IPeopleDirectory[]) {}

  async execute(input: PeopleSearchInput): Promise<Result<Person[]>> {
    const lists: Person[][] = [];
    for (const directory of this.directories) {
      const result = await directory.search(input);
      // A source that fails (e.g. Entra scopes not yet consented) is skipped, not
      // fatal — resolution degrades to whatever sources remain (ADR-018).
      if (result.error) continue;
      lists.push(result.data);
    }
    const merged = mergePeople(lists, input.limit);
    const withTyped = appendTypedEmail(merged, input.query);
    return ok(withTyped.slice(0, input.limit));
  }
}
