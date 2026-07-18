import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORGANISATION_RESOLUTION,
  emailDomainOf,
  parseOrganisationResolution,
  resolveOrganisation,
  type OrganisationResolution,
} from "./organisation-resolution";

describe("emailDomainOf", () => {
  it("extracts a lower-cased domain from an address", () => {
    expect(emailDomainOf("Alice@Procurement.ACME.com")).toBe("procurement.acme.com");
  });

  it("uses the last @ so tagged local parts do not confuse the split", () => {
    expect(emailDomainOf("weird@name@example.org")).toBe("example.org");
  });

  it("returns null for a value with no domain", () => {
    expect(emailDomainOf("not-an-email")).toBeNull();
    expect(emailDomainOf("trailing@")).toBeNull();
    expect(emailDomainOf("")).toBeNull();
  });
});

describe("resolveOrganisation — admin strategy", () => {
  it("never runs sign-in logic (organisation stays admin-set)", () => {
    const decision = resolveOrganisation({ strategy: "admin" }, {});
    expect(decision).toEqual({ kind: "noop" });
  });
});

describe("resolveOrganisation — sso_claim strategy", () => {
  const config: OrganisationResolution = {
    strategy: "sso_claim",
    ssoClaim: { claimName: "org" },
  };

  it("resolves by the claim value when present", () => {
    const decision = resolveOrganisation(config, { claim: { value: "procurement" } });
    expect(decision).toEqual({ kind: "resolveByClaim", claimValue: "procurement" });
  });

  it("leaves the user unaffiliated when the claim is absent", () => {
    expect(resolveOrganisation(config, { claim: { value: null } })).toEqual({ kind: "unaffiliated" });
    expect(resolveOrganisation(config, {})).toEqual({ kind: "unaffiliated" });
  });

  it("treats a blank claim value as absent", () => {
    expect(resolveOrganisation(config, { claim: { value: "   " } })).toEqual({ kind: "unaffiliated" });
  });
});

describe("resolveOrganisation — email_domain strategy", () => {
  const config: OrganisationResolution = {
    strategy: "email_domain",
    emailDomain: {
      domainToOrg: [
        { domain: "procurement.acme.com", organisationId: "org-procurement" },
        { domain: "hr.acme.com", organisationId: "org-hr" },
      ],
      onUnmatched: "unaffiliated",
    },
  };

  it("assigns the mapped organisation for a verified, matching domain", () => {
    const decision = resolveOrganisation(config, {
      email: { domain: "procurement.acme.com", verified: true },
    });
    expect(decision).toEqual({ kind: "assignExisting", organisationId: "org-procurement" });
  });

  it("matches the domain case-insensitively", () => {
    const decision = resolveOrganisation(config, {
      email: { domain: "HR.acme.com", verified: true },
    });
    expect(decision).toEqual({ kind: "assignExisting", organisationId: "org-hr" });
  });

  it("does not trust an unverified email — falls through to onUnmatched", () => {
    const decision = resolveOrganisation(config, {
      email: { domain: "procurement.acme.com", verified: false },
    });
    expect(decision).toEqual({ kind: "unaffiliated" });
  });

  it("leaves an unmatched domain unaffiliated when onUnmatched is unaffiliated", () => {
    const decision = resolveOrganisation(config, {
      email: { domain: "gmail.com", verified: true },
    });
    expect(decision).toEqual({ kind: "unaffiliated" });
  });

  it("falls through to nomination when onUnmatched is nominate", () => {
    const nominateConfig: OrganisationResolution = {
      strategy: "email_domain",
      emailDomain: { domainToOrg: [], onUnmatched: "nominate" },
    };
    const decision = resolveOrganisation(nominateConfig, {
      email: { domain: "startup.io", verified: true },
    });
    expect(decision).toEqual({ kind: "nominate" });
  });
});

describe("resolveOrganisation — self_nomination strategy", () => {
  const createOrJoin: OrganisationResolution = {
    strategy: "self_nomination",
    selfNomination: { mode: "create_or_join", allowlist: ["Procurement", "HR"] },
  };

  it("prompts the user when no nomination has been made yet", () => {
    expect(resolveOrganisation(createOrJoin, {})).toEqual({ kind: "nominate" });
  });

  it("joins an existing organisation the user picked", () => {
    const decision = resolveOrganisation(createOrJoin, {
      nomination: { joinOrganisationId: "org-hr" },
    });
    expect(decision).toEqual({ kind: "assignExisting", organisationId: "org-hr" });
  });

  it("creates an allowlisted organisation the user named", () => {
    const decision = resolveOrganisation(createOrJoin, {
      nomination: { createName: "Procurement" },
    });
    expect(decision).toEqual({ kind: "createNominated", name: "Procurement" });
  });

  it("matches the allowlist case-insensitively and trims", () => {
    const decision = resolveOrganisation(createOrJoin, {
      nomination: { createName: "  procurement  " },
    });
    expect(decision).toEqual({ kind: "createNominated", name: "procurement" });
  });

  it("rejects creating an organisation outside the allowlist", () => {
    const decision = resolveOrganisation(createOrJoin, {
      nomination: { createName: "Rogue Corp" },
    });
    expect(decision).toEqual({
      kind: "rejected",
      reason: "The organisation “Rogue Corp” is not on the allowlist.",
    });
  });

  it("allows any created name when no allowlist is set", () => {
    const open: OrganisationResolution = {
      strategy: "self_nomination",
      selfNomination: { mode: "create_or_join" },
    };
    expect(resolveOrganisation(open, { nomination: { createName: "Anything" } })).toEqual({
      kind: "createNominated",
      name: "Anything",
    });
  });

  it("rejects creating when the mode is join_existing", () => {
    const joinOnly: OrganisationResolution = {
      strategy: "self_nomination",
      selfNomination: { mode: "join_existing" },
    };
    const decision = resolveOrganisation(joinOnly, { nomination: { createName: "New Org" } });
    expect(decision).toEqual({
      kind: "rejected",
      reason: "New organisations cannot be created; pick an existing one.",
    });
  });
});

describe("parseOrganisationResolution", () => {
  it("defaults to the admin strategy on malformed JSON", () => {
    expect(parseOrganisationResolution("not json")).toEqual(DEFAULT_ORGANISATION_RESOLUTION);
  });

  it("defaults to the admin strategy on an unknown strategy", () => {
    expect(parseOrganisationResolution(JSON.stringify({ strategy: "wat" }))).toEqual(
      DEFAULT_ORGANISATION_RESOLUTION,
    );
  });

  it("reads a well-formed email_domain config", () => {
    const raw = JSON.stringify({
      strategy: "email_domain",
      emailDomain: {
        domainToOrg: [{ domain: "acme.com", organisationId: "org-1" }],
        onUnmatched: "nominate",
      },
    });
    expect(parseOrganisationResolution(raw)).toEqual({
      strategy: "email_domain",
      emailDomain: {
        domainToOrg: [{ domain: "acme.com", organisationId: "org-1" }],
        onUnmatched: "nominate",
      },
    });
  });

  it("drops malformed domain entries and defaults a bad onUnmatched", () => {
    const raw = JSON.stringify({
      strategy: "email_domain",
      emailDomain: {
        domainToOrg: [{ domain: "acme.com", organisationId: "org-1" }, { domain: 5 }],
        onUnmatched: "explode",
      },
    });
    expect(parseOrganisationResolution(raw)).toEqual({
      strategy: "email_domain",
      emailDomain: {
        domainToOrg: [{ domain: "acme.com", organisationId: "org-1" }],
        onUnmatched: "unaffiliated",
      },
    });
  });

  it("reads a well-formed self_nomination config", () => {
    const raw = JSON.stringify({
      strategy: "self_nomination",
      selfNomination: { mode: "join_existing", allowlist: ["HR", "Legal"] },
    });
    expect(parseOrganisationResolution(raw)).toEqual({
      strategy: "self_nomination",
      selfNomination: { mode: "join_existing", allowlist: ["HR", "Legal"] },
    });
  });
});
