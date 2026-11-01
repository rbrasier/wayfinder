// The actor behind a request, carried to the audit logger by a request-scoped
// store rather than through use-case signatures (ADR-060).
//
// `userId` is the account the action is taken under — during a simulated session
// that is the impersonated user, because the audit row must agree with the
// artefact it describes. `impersonatorId` names the admin actually driving, and
// is null whenever nobody is simulating.
//
// This is attribution only. No authorisation decision may read it (ADR-060 §6).

export interface AuditActorContext {
  readonly userId: string | null;
  readonly impersonatorId: string | null;
}
