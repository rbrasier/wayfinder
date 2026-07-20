// How a user's organisation is populated (ADR-038 §4). This is an internal
// sharing scope, not isolation, so resolution only decides which organisation a
// user is discovered against — it never gates data access. The pure mapping here
// is unit-tested without a database; the IO (reading an IdP claim, creating an
// organisation, showing the nomination prompt) lives in the adapter/app sign-in
// path and consumes the decision this returns.

export type OrganisationResolutionStrategy =
  | "admin"
  | "sso_claim"
  | "email_domain"
  | "self_nomination";

export type EmailDomainOnUnmatched = "unaffiliated" | "nominate";
export type SelfNominationMode = "create_or_join" | "join_existing";

export interface DomainOrgMapping {
  readonly domain: string;
  readonly organisationId: string;
}

export interface OrganisationResolution {
  readonly strategy: OrganisationResolutionStrategy;
  readonly ssoClaim?: { readonly claimName: string };
  readonly emailDomain?: {
    readonly domainToOrg: readonly DomainOrgMapping[];
    readonly onUnmatched: EmailDomainOnUnmatched;
  };
  readonly selfNomination?: {
    readonly mode: SelfNominationMode;
    readonly allowlist?: readonly string[];
  };
}

// Self-nomination is the default: when organisations are enabled, a first-time
// user without an organisation is prompted to create or join one (ADR-038 §4).
export const DEFAULT_ORGANISATION_RESOLUTION: OrganisationResolution = {
  strategy: "self_nomination",
  selfNomination: { mode: "create_or_join" },
};

// Facts gathered on the sign-in path, fed into the pure mapping. Everything is
// optional so the same function serves both first sign-in (no nomination yet)
// and the follow-up once the user has responded.
export interface OrganisationResolutionInput {
  readonly claim?: { readonly value: string | null };
  readonly email?: { readonly domain: string | null; readonly verified: boolean };
  readonly nomination?: { readonly joinOrganisationId?: string; readonly createName?: string };
}

// What the IO layer must do to populate the user's organisation.
export type OrganisationResolutionDecision =
  // admin strategy — leave whatever an administrator set; run no sign-in logic.
  | { kind: "noop" }
  // Leave organisation_id null.
  | { kind: "unaffiliated" }
  // Place the user in a known organisation.
  | { kind: "assignExisting"; organisationId: string }
  // IO: find-or-create the organisation keyed by this SSO claim value, then assign.
  | { kind: "resolveByClaim"; claimValue: string }
  // Prompt the user to create or join on first sign-in.
  | { kind: "nominate" }
  // IO: create an organisation with this name, then assign.
  | { kind: "createNominated"; name: string }
  // The nomination is not permitted (outside the allowlist, or create disallowed).
  | { kind: "rejected"; reason: string };

const isNonBlank = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

// Extracts the domain from an email address, lower-cased. Splits on the last `@`
// so an unusual local part cannot shift the domain, and returns null for
// anything without a real domain.
export const emailDomainOf = (email: string): string | null => {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain.length > 0 ? domain : null;
};

const resolveSsoClaim = (input: OrganisationResolutionInput): OrganisationResolutionDecision => {
  const value = input.claim?.value;
  if (!isNonBlank(value)) return { kind: "unaffiliated" };
  return { kind: "resolveByClaim", claimValue: value.trim() };
};

const resolveEmailDomain = (
  config: NonNullable<OrganisationResolution["emailDomain"]>,
  input: OrganisationResolutionInput,
): OrganisationResolutionDecision => {
  const onUnmatched: OrganisationResolutionDecision =
    config.onUnmatched === "nominate" ? { kind: "nominate" } : { kind: "unaffiliated" };
  const email = input.email;
  // An unverified address is never trusted to place a user (shared/spoofable
  // domains); it falls through exactly as an unmatched domain would.
  if (!email || !email.verified || !isNonBlank(email.domain)) return onUnmatched;
  const wanted = email.domain.trim().toLowerCase();
  const match = config.domainToOrg.find((entry) => entry.domain.trim().toLowerCase() === wanted);
  return match ? { kind: "assignExisting", organisationId: match.organisationId } : onUnmatched;
};

const resolveSelfNomination = (
  config: NonNullable<OrganisationResolution["selfNomination"]>,
  input: OrganisationResolutionInput,
): OrganisationResolutionDecision => {
  const nomination = input.nomination;
  if (!nomination) return { kind: "nominate" };
  if (isNonBlank(nomination.joinOrganisationId)) {
    return { kind: "assignExisting", organisationId: nomination.joinOrganisationId.trim() };
  }
  if (!isNonBlank(nomination.createName)) return { kind: "nominate" };
  if (config.mode === "join_existing") {
    return { kind: "rejected", reason: "New organisations cannot be created; pick an existing one." };
  }
  const name = nomination.createName.trim();
  if (config.allowlist && config.allowlist.length > 0) {
    const allowed = config.allowlist.some((entry) => entry.trim().toLowerCase() === name.toLowerCase());
    if (!allowed) {
      return { kind: "rejected", reason: `The organisation “${name}” is not on the allowlist.` };
    }
  }
  return { kind: "createNominated", name };
};

export const resolveOrganisation = (
  config: OrganisationResolution,
  input: OrganisationResolutionInput,
): OrganisationResolutionDecision => {
  if (config.strategy === "admin") return { kind: "noop" };
  if (config.strategy === "sso_claim") return resolveSsoClaim(input);
  if (config.strategy === "email_domain") {
    if (!config.emailDomain) return { kind: "unaffiliated" };
    return resolveEmailDomain(config.emailDomain, input);
  }
  if (!config.selfNomination) return { kind: "nominate" };
  return resolveSelfNomination(config.selfNomination, input);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseDomainToOrg = (raw: unknown): DomainOrgMapping[] => {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!isObject(entry)) return [];
    const { domain, organisationId } = entry;
    if (typeof domain !== "string" || domain.length === 0) return [];
    if (typeof organisationId !== "string" || organisationId.length === 0) return [];
    return [{ domain, organisationId }];
  });
};

const parseAllowlist = (raw: unknown): string[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const entries = raw.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return entries.length > 0 ? entries : undefined;
};

// Tolerant parse for the stored JSON: any malformed value falls back to the
// admin strategy, so a bad row never silently auto-assigns users somewhere
// surprising — an admin keeps control.
export const parseOrganisationResolution = (raw: string): OrganisationResolution => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return DEFAULT_ORGANISATION_RESOLUTION;
    const strategy = parsed.strategy;
    if (strategy === "admin") return { strategy: "admin" };
    if (strategy === "sso_claim") {
      const claim = isObject(parsed.ssoClaim) ? parsed.ssoClaim : {};
      const claimName = typeof claim.claimName === "string" ? claim.claimName : "";
      return { strategy: "sso_claim", ssoClaim: { claimName } };
    }
    if (strategy === "email_domain") {
      const source = isObject(parsed.emailDomain) ? parsed.emailDomain : {};
      const onUnmatched: EmailDomainOnUnmatched =
        source.onUnmatched === "nominate" ? "nominate" : "unaffiliated";
      return {
        strategy: "email_domain",
        emailDomain: { domainToOrg: parseDomainToOrg(source.domainToOrg), onUnmatched },
      };
    }
    if (strategy === "self_nomination") {
      const source = isObject(parsed.selfNomination) ? parsed.selfNomination : {};
      const mode: SelfNominationMode = source.mode === "join_existing" ? "join_existing" : "create_or_join";
      const allowlist = parseAllowlist(source.allowlist);
      return {
        strategy: "self_nomination",
        selfNomination: allowlist ? { mode, allowlist } : { mode },
      };
    }
    return DEFAULT_ORGANISATION_RESOLUTION;
  } catch {
    return DEFAULT_ORGANISATION_RESOLUTION;
  }
};

export const ORGANISATION_RESOLUTION_SETTING_KEY = "organisation_resolution";
