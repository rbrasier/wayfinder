import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import {
  domainError,
  err,
  normaliseEmail,
  ok,
  type AuthConfig,
  type IUserRepository,
  type Result,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { core_sessions, core_users } from "../db/schema/core";
import { enforceSessionConcurrency } from "./session-concurrency";
import type { SessionRevocationRegistry } from "./session-revocation";

export interface PkiConfig {
  // The trust anchor, read from PKI_TRUSTED_PROXY_IPS and enforced here — the
  // one place in the codebase that needs the addresses themselves. The session
  // TTL is not here: it lives in the database and is resolved per request, so a
  // change applies without a redeploy (ADR-042 §1).
  readonly trustedProxyIps: readonly string[];
}

// The narrow slice of the runtime config store this adapter needs.
export interface PkiAuthConfigSource {
  getAuthConfig(): Promise<AuthConfig>;
}

interface CertIdentity {
  readonly email: string;
  readonly name: string;
  readonly fingerprint: string;
  readonly subjectDn: string;
}

export class PkiCertAdapter {
  // Constructed unconditionally: configuration decides whether PKI answers, not
  // wiring. An empty trusted-proxy list is therefore an ordinary runtime state
  // here, reported per request rather than thrown at boot (ADR-042 §1).
  constructor(
    private readonly db: Database,
    private readonly userRepository: IUserRepository,
    private readonly config: PkiConfig,
    private readonly runtimeConfig: PkiAuthConfigSource,
    private readonly sessionRevocations: SessionRevocationRegistry,
  ) {}

  async authenticate(
    headers: Headers,
    sourceIp: string,
  ): Promise<Result<{ token: string; userId: string }>> {
    const authConfig = await this.runtimeConfig.getAuthConfig();

    // Defence in depth behind the route's own 403: whatever calls this, a
    // disabled or ungated PKI must never mint a session.
    if (!authConfig.pkiEnabled) {
      return err(domainError("UNAUTHORIZED", "PKI sign-in is disabled."));
    }

    if (this.config.trustedProxyIps.length === 0) {
      return err(
        domainError(
          "INFRA_FAILURE",
          "PKI sign-in is enabled but PKI_TRUSTED_PROXY_IPS is not set, so no request can be trusted.",
        ),
      );
    }

    if (!this.config.trustedProxyIps.includes(sourceIp)) {
      return err(domainError("UNAUTHORIZED", "Request did not originate from a trusted proxy."));
    }

    const verified = headers.get("x-ssl-client-verified");
    if (verified !== "SUCCESS") {
      return err(domainError("UNAUTHORIZED", "Client certificate verification failed."));
    }

    const identityResult = this.extractIdentity(headers);
    if (identityResult.error) return identityResult;
    const identity = identityResult.data;

    const userResult = await this.findOrCreateUser(identity);
    if (userResult.error) return userResult;
    const user = userResult.data;

    const updateResult = await this.updateCertFields(user.id, identity);
    if (updateResult.error) return updateResult;

    // Certificate sign-in mints its own rows, so Better Auth's hook never sees
    // it; the limit is applied here or not at all (ADR-035 §3).
    const admitted = await enforceSessionConcurrency(this.db, this.sessionRevocations, {
      userId: user.id,
      policy: authConfig.sessionPolicy,
    });
    if (!admitted) {
      return err(
        domainError(
          "UNAUTHORIZED",
          "You already have the maximum number of active sessions allowed. Sign out on another device and try again.",
        ),
      );
    }

    return this.createSession(user.id, authConfig.pki.sessionTtlHours);
  }

  private extractIdentity(headers: Headers): Result<CertIdentity> {
    const subjectDn = headers.get("x-ssl-client-subject-dn");
    const fingerprint = headers.get("x-ssl-client-fingerprint");
    const sanEmail = headers.get("x-ssl-client-san-email");

    if (!subjectDn || !fingerprint) {
      return err(domainError("VALIDATION_FAILED", "Missing required certificate headers."));
    }

    const email = (sanEmail?.trim() || null) ?? this.extractEmailFromDn(subjectDn);
    if (!email) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          "Cannot extract email from certificate: no SAN email and CN is not an email address.",
        ),
      );
    }

    const name = this.extractCnFromDn(subjectDn) ?? email;
    // Certificate subject names carry whatever case the CA issued; the account
    // key must not depend on it, or the same person gets a second user row.
    return ok({ email: normaliseEmail(email), name, fingerprint, subjectDn });
  }

  private extractEmailFromDn(dn: string): string | null {
    const cnMatch = dn.match(/CN=([^,]+)/i);
    if (!cnMatch?.[1]) return null;
    const cnValue = cnMatch[1].trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cnValue) ? cnValue : null;
  }

  private extractCnFromDn(dn: string): string | null {
    const cnMatch = dn.match(/CN=([^,]+)/i);
    return cnMatch?.[1] ? cnMatch[1].trim() : null;
  }

  private async findOrCreateUser(identity: CertIdentity): Promise<Result<{ id: string }>> {
    const findResult = await this.userRepository.findByEmail(identity.email);
    if (findResult.error) return findResult;
    if (findResult.data) return ok({ id: findResult.data.id });

    const createResult = await this.userRepository.create({
      email: identity.email,
      name: identity.name,
      isAdmin: false,
    });
    if (createResult.error) return createResult;
    return ok({ id: createResult.data.id });
  }

  private async updateCertFields(
    userId: string,
    identity: CertIdentity,
  ): Promise<Result<void>> {
    try {
      await this.db
        .update(core_users)
        .set({
          cert_fingerprint: identity.fingerprint,
          cert_subject_dn: identity.subjectDn,
          updated_at: new Date(),
        })
        .where(eq(core_users.id, userId));
      return ok(undefined as void);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update certificate fields.", cause));
    }
  }

  private async createSession(
    userId: string,
    sessionTtlHours: number,
  ): Promise<Result<{ token: string; userId: string }>> {
    try {
      const token = randomUUID();
      const expiresAt = new Date(Date.now() + sessionTtlHours * 60 * 60 * 1000);
      await this.db.insert(core_sessions).values({
        user_id: userId,
        token,
        expires_at: expiresAt,
      });
      return ok({ token, userId });
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create session.", cause));
    }
  }
}
