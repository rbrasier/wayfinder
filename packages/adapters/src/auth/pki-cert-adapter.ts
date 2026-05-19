import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { domainError, err, ok, type IUserRepository, type Result } from "@rbrasier/domain";
import type { Database } from "../db/client";
import { core_sessions, core_users } from "../db/schema/core";

export interface PkiConfig {
  readonly trustedProxyIps: readonly string[];
  readonly sessionTtlHours: number;
}

interface CertIdentity {
  readonly email: string;
  readonly name: string;
  readonly fingerprint: string;
  readonly subjectDn: string;
}

export class PkiCertAdapter {
  constructor(
    private readonly db: Database,
    private readonly userRepository: IUserRepository,
    private readonly config: PkiConfig,
  ) {
    if (config.trustedProxyIps.length === 0) {
      throw new Error("PKI_TRUSTED_PROXY_IPS must not be empty when PKI auth is enabled");
    }
  }

  async authenticate(
    headers: Headers,
    sourceIp: string,
  ): Promise<Result<{ token: string; userId: string }>> {
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

    return this.createSession(user.id);
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
    return ok({ email, name, fingerprint, subjectDn });
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

  private async createSession(userId: string): Promise<Result<{ token: string; userId: string }>> {
    try {
      const token = randomUUID();
      const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 60 * 60 * 1000);
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
