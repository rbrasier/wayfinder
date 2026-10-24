// Who is asking (ADR-066 §3). A delegated User Admin reaches the user and role
// use cases too, so a use case that could hand out admin access must know
// whether the caller is a Global Admin rather than trust the procedure gate
// alone. `userId` is null for system callers that act for no signed-in person.
export interface AdminCaller {
  readonly isAdmin: boolean;
  readonly userId: string | null;
}
