import { logger } from '@/lib/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

type IdPProtocol = 'saml' | 'oidc' | 'ldap';
type IdPStatus = 'active' | 'degraded' | 'unavailable' | 'maintenance';
type ProvisioningAction = 'created' | 'updated' | 'linked' | 'skipped';

interface AttributeMapping {
  source: string;
  target: string;
  transform?: 'lowercase' | 'uppercase' | 'trim' | 'email_domain' | 'split_first';
  required: boolean;
  defaultValue?: string;
}

interface IdPConfig {
  id: string;
  tenantId: string;
  protocol: IdPProtocol;
  name: string;
  enabled: boolean;
  priority: number;
  entityId: string;
  ssoUrl: string;
  certificateFingerprint?: string;
  clientId?: string;
  clientSecret?: string;
  discoveryUrl?: string;
  ldapUrl?: string;
  ldapBaseDn?: string;
  ldapBindDn?: string;
  attributeMappings: AttributeMapping[];
  allowedDomains: string[];
  jitProvisioningEnabled: boolean;
  defaultRoles: string[];
  sessionMaxAge: number;
  createdAt: Date;
  updatedAt: Date;
}

interface FederationMetadata {
  idpId: string;
  protocol: IdPProtocol;
  entityId: string;
  endpoints: Record<string, string>;
  certificates: string[];
  lastRefreshed: Date;
  expiresAt: Date;
}

interface FederatedUser {
  id: string;
  tenantId: string;
  idpId: string;
  externalId: string;
  email: string;
  displayName: string;
  attributes: Record<string, unknown>;
  roles: string[];
  provisionedAt: Date;
  lastLoginAt: Date;
}

interface IdPSession {
  sessionId: string;
  userId: string;
  idpId: string;
  tenantId: string;
  idpSessionIndex?: string;
  boundAt: Date;
  expiresAt: Date;
  active: boolean;
}

interface IdPHealthStatus {
  idpId: string;
  status: IdPStatus;
  latencyMs: number;
  lastChecked: Date;
  consecutiveFailures: number;
  lastError?: string;
}

interface JITProvisioningResult {
  action: ProvisioningAction;
  user: FederatedUser;
  warnings: string[];
}

interface AuthenticationResult {
  success: boolean;
  user?: FederatedUser;
  session?: IdPSession;
  idpId: string;
  protocol: IdPProtocol;
  usedFallback: boolean;
  error?: string;
}

// ─── Implementation ──────────────────────────────────────────────────────────

class SSOFederationManager {
  private idpConfigs = new Map<string, IdPConfig>();
  private metadata = new Map<string, FederationMetadata>();
  private users = new Map<string, FederatedUser>();
  private sessions = new Map<string, IdPSession>();
  private healthStatuses = new Map<string, IdPHealthStatus>();
  private tenantIdpIndex = new Map<string, Set<string>>();
  private emailUserIndex = new Map<string, string>();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof setInterval !== 'undefined') {
      this.healthCheckInterval = setInterval(() => this.runHealthChecks(), 60_000);
    }
    logger.info('SSOFederationManager initialized');
  }

  // ── IdP Configuration ────────────────────────────────────────────────────

  registerIdP(config: Omit<IdPConfig, 'createdAt' | 'updatedAt'>): IdPConfig {
    if (!config.id || !config.tenantId || !config.protocol) {
      throw new Error('IdP config requires id, tenantId, and protocol');
    }
    if (config.protocol === 'saml' && !config.entityId) {
      throw new Error('SAML IdP requires entityId');
    }
    if (config.protocol === 'oidc' && (!config.clientId || !config.discoveryUrl)) {
      throw new Error('OIDC IdP requires clientId and discoveryUrl');
    }
    if (config.protocol === 'ldap' && (!config.ldapUrl || !config.ldapBaseDn)) {
      throw new Error('LDAP IdP requires ldapUrl and ldapBaseDn');
    }

    const existing = this.getTenantIdPs(config.tenantId);
    const domainConflict = existing.find(
      (idp) =>
        idp.id !== config.id &&
        idp.allowedDomains.some((d) => config.allowedDomains.includes(d)),
    );
    if (domainConflict) {
      throw new Error(
        `Domain conflict with existing IdP ${domainConflict.id} for domains: ${domainConflict.allowedDomains.filter((d) => config.allowedDomains.includes(d)).join(', ')}`,
      );
    }

    const now = new Date();
    const full: IdPConfig = { ...config, createdAt: now, updatedAt: now };
    this.idpConfigs.set(config.id, full);

    if (!this.tenantIdpIndex.has(config.tenantId)) {
      this.tenantIdpIndex.set(config.tenantId, new Set());
    }
    this.tenantIdpIndex.get(config.tenantId)!.add(config.id);

    this.healthStatuses.set(config.id, {
      idpId: config.id,
      status: 'active',
      latencyMs: 0,
      lastChecked: now,
      consecutiveFailures: 0,
    });

    logger.info('IdP registered', { idpId: config.id, tenantId: config.tenantId, protocol: config.protocol });
    return full;
  }

  updateIdP(idpId: string, updates: Partial<Omit<IdPConfig, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>): IdPConfig {
    const existing = this.idpConfigs.get(idpId);
    if (!existing) throw new Error(`IdP ${idpId} not found`);

    const updated: IdPConfig = { ...existing, ...updates, updatedAt: new Date() };
    this.idpConfigs.set(idpId, updated);
    logger.info('IdP updated', { idpId });
    return updated;
  }

  removeIdP(idpId: string): void {
    const config = this.idpConfigs.get(idpId);
    if (!config) return;

    const activeSessions = Array.from(this.sessions.values()).filter(
      (s) => s.idpId === idpId && s.active,
    );
    if (activeSessions.length > 0) {
      for (const session of activeSessions) {
        session.active = false;
      }
      logger.warn('Terminated active sessions during IdP removal', {
        idpId,
        terminatedCount: activeSessions.length,
      });
    }

    this.idpConfigs.delete(idpId);
    this.metadata.delete(idpId);
    this.healthStatuses.delete(idpId);
    this.tenantIdpIndex.get(config.tenantId)?.delete(idpId);
    logger.info('IdP removed', { idpId });
  }

  getIdP(idpId: string): IdPConfig | null {
    return this.idpConfigs.get(idpId) ?? null;
  }

  getTenantIdPs(tenantId: string): IdPConfig[] {
    const ids = this.tenantIdpIndex.get(tenantId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.idpConfigs.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.priority - b.priority);
  }

  // ── Attribute Mapping ────────────────────────────────────────────────────

  mapAttributes(
    idpId: string,
    rawAttributes: Record<string, unknown>,
  ): Record<string, unknown> {
    const config = this.idpConfigs.get(idpId);
    if (!config) throw new Error(`IdP ${idpId} not found`);

    const mapped: Record<string, unknown> = {};
    const warnings: string[] = [];

    for (const mapping of config.attributeMappings) {
      let value = rawAttributes[mapping.source];

      if (value === undefined || value === null || value === '') {
        if (mapping.required && !mapping.defaultValue) {
          warnings.push(`Required attribute "${mapping.source}" missing from IdP response`);
          continue;
        }
        value = mapping.defaultValue ?? null;
      }

      if (value !== null && typeof value === 'string' && mapping.transform) {
        value = this.applyTransform(value, mapping.transform);
      }

      mapped[mapping.target] = value;
    }

    if (warnings.length > 0) {
      logger.warn('Attribute mapping warnings', { idpId, warnings });
    }

    return mapped;
  }

  private applyTransform(value: string, transform: AttributeMapping['transform']): string {
    switch (transform) {
      case 'lowercase':
        return value.toLowerCase();
      case 'uppercase':
        return value.toUpperCase();
      case 'trim':
        return value.trim();
      case 'email_domain':
        return value.includes('@') ? value.split('@')[1] : value;
      case 'split_first':
        return value.split(/\s+/)[0] || value;
      default:
        return value;
    }
  }

  // ── JIT Provisioning ─────────────────────────────────────────────────────

  provisionUser(
    idpId: string,
    externalId: string,
    rawAttributes: Record<string, unknown>,
  ): JITProvisioningResult {
    const config = this.idpConfigs.get(idpId);
    if (!config) throw new Error(`IdP ${idpId} not found`);
    if (!config.jitProvisioningEnabled) {
      throw new Error(`JIT provisioning not enabled for IdP ${idpId}`);
    }

    const mapped = this.mapAttributes(idpId, rawAttributes);
    const email = (mapped['email'] as string) ?? '';
    const displayName = (mapped['displayName'] as string) ?? externalId;
    const warnings: string[] = [];

    if (email) {
      const domain = email.split('@')[1];
      if (domain && config.allowedDomains.length > 0 && !config.allowedDomains.includes(domain)) {
        throw new Error(`Email domain "${domain}" not allowed for IdP ${idpId}`);
      }
    }

    const existingByEmail = email ? this.emailUserIndex.get(email) : undefined;
    if (existingByEmail) {
      const existingUser = this.users.get(existingByEmail)!;
      if (existingUser.idpId !== idpId) {
        existingUser.idpId = idpId;
        existingUser.externalId = externalId;
        warnings.push('User linked to new IdP from previous IdP');
      }
      existingUser.displayName = displayName;
      existingUser.attributes = mapped;
      existingUser.lastLoginAt = new Date();
      logger.info('JIT user updated', { userId: existingUser.id, idpId });
      return { action: existingUser.idpId === idpId ? 'updated' : 'linked', user: existingUser, warnings };
    }

    const existingByExternal = Array.from(this.users.values()).find(
      (u) => u.idpId === idpId && u.externalId === externalId,
    );
    if (existingByExternal) {
      existingByExternal.attributes = mapped;
      existingByExternal.displayName = displayName;
      existingByExternal.lastLoginAt = new Date();
      if (email && existingByExternal.email !== email) {
        this.emailUserIndex.delete(existingByExternal.email);
        existingByExternal.email = email;
        this.emailUserIndex.set(email, existingByExternal.id);
        warnings.push('User email updated from IdP');
      }
      logger.info('JIT user updated by externalId', { externalId, idpId });
      return { action: 'updated', user: existingByExternal, warnings };
    }

    const userId = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const newUser: FederatedUser = {
      id: userId,
      tenantId: config.tenantId,
      idpId,
      externalId,
      email,
      displayName,
      attributes: mapped,
      roles: [...config.defaultRoles],
      provisionedAt: new Date(),
      lastLoginAt: new Date(),
    };

    this.users.set(userId, newUser);
    if (email) this.emailUserIndex.set(email, userId);
    logger.info('JIT user provisioned', { userId, idpId, tenantId: config.tenantId });
    return { action: 'created', user: newUser, warnings };
  }

  // ── Federation Metadata ──────────────────────────────────────────────────

  storeMetadata(meta: Omit<FederationMetadata, 'lastRefreshed'>): FederationMetadata {
    const full: FederationMetadata = { ...meta, lastRefreshed: new Date() };
    this.metadata.set(meta.idpId, full);
    logger.info('Federation metadata stored', { idpId: meta.idpId });
    return full;
  }

  getMetadata(idpId: string): FederationMetadata | null {
    const meta = this.metadata.get(idpId);
    if (!meta) return null;
    if (meta.expiresAt < new Date()) {
      logger.warn('Federation metadata expired', { idpId });
      return null;
    }
    return meta;
  }

  refreshMetadata(idpId: string): FederationMetadata | null {
    const meta = this.metadata.get(idpId);
    if (!meta) return null;
    meta.lastRefreshed = new Date();
    meta.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    logger.info('Federation metadata refreshed', { idpId });
    return meta;
  }

  // ── Session Binding ──────────────────────────────────────────────────────

  bindSession(userId: string, idpId: string, idpSessionIndex?: string): IdPSession {
    const config = this.idpConfigs.get(idpId);
    if (!config) throw new Error(`IdP ${idpId} not found`);

    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date();
    const session: IdPSession = {
      sessionId,
      userId,
      idpId,
      tenantId: config.tenantId,
      idpSessionIndex,
      boundAt: now,
      expiresAt: new Date(now.getTime() + config.sessionMaxAge * 1000),
      active: true,
    };

    this.sessions.set(sessionId, session);
    logger.info('Session bound to IdP', { sessionId, userId, idpId });
    return session;
  }

  validateSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.active) return false;
    if (session.expiresAt < new Date()) {
      session.active = false;
      logger.info('Session expired', { sessionId });
      return false;
    }
    const health = this.healthStatuses.get(session.idpId);
    if (health && health.status === 'unavailable') {
      logger.warn('IdP unavailable, session still valid within grace period', {
        sessionId,
        idpId: session.idpId,
      });
    }
    return true;
  }

  terminateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.active = false;
      logger.info('Session terminated', { sessionId });
    }
  }

  terminateIdPSessions(idpId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.idpId === idpId && session.active) {
        session.active = false;
        count++;
      }
    }
    if (count > 0) {
      logger.info('Bulk IdP sessions terminated', { idpId, count });
    }
    return count;
  }

  // ── IdP Health Monitoring ────────────────────────────────────────────────

  reportHealthCheck(idpId: string, latencyMs: number, success: boolean, error?: string): IdPHealthStatus {
    const existing = this.healthStatuses.get(idpId);
    if (!existing) throw new Error(`IdP ${idpId} not registered`);

    existing.latencyMs = latencyMs;
    existing.lastChecked = new Date();

    if (success) {
      existing.consecutiveFailures = 0;
      existing.status = latencyMs > 5000 ? 'degraded' : 'active';
      existing.lastError = undefined;
    } else {
      existing.consecutiveFailures++;
      existing.lastError = error;
      existing.status = existing.consecutiveFailures >= 3 ? 'unavailable' : 'degraded';
    }

    if (existing.status === 'unavailable') {
      logger.error('IdP marked unavailable', new Error(error ?? 'Health check failed'), {
        idpId,
        consecutiveFailures: existing.consecutiveFailures,
      });
    }

    return { ...existing };
  }

  getIdPHealth(idpId: string): IdPHealthStatus | null {
    return this.healthStatuses.get(idpId) ? { ...this.healthStatuses.get(idpId)! } : null;
  }

  private runHealthChecks(): void {
    const now = new Date();
    for (const [idpId, health] of this.healthStatuses) {
      const staleness = now.getTime() - health.lastChecked.getTime();
      if (staleness > 5 * 60_000 && health.status === 'active') {
        health.status = 'degraded';
        logger.warn('IdP health check stale', { idpId, stalenessMs: staleness });
      }
    }

    // Expire old sessions
    for (const [sessionId, session] of this.sessions) {
      if (session.active && session.expiresAt < now) {
        session.active = false;
      }
    }
  }

  // ── Fallback Authentication ──────────────────────────────────────────────

  authenticate(
    tenantId: string,
    emailOrDomain: string,
    rawAttributes: Record<string, unknown>,
  ): AuthenticationResult {
    const domain = emailOrDomain.includes('@')
      ? emailOrDomain.split('@')[1]
      : emailOrDomain;
    const idps = this.getTenantIdPs(tenantId);

    if (idps.length === 0) {
      return { success: false, idpId: '', protocol: 'oidc', usedFallback: false, error: 'No IdPs configured for tenant' };
    }

    const matchingIdPs = idps.filter(
      (idp) => idp.enabled && (idp.allowedDomains.length === 0 || idp.allowedDomains.includes(domain)),
    );

    for (const idp of matchingIdPs) {
      const health = this.healthStatuses.get(idp.id);
      if (health && health.status === 'unavailable') continue;

      try {
        const email = emailOrDomain.includes('@') ? emailOrDomain : '';
        const externalId = (rawAttributes['sub'] as string) ?? (rawAttributes['nameID'] as string) ?? email;

        if (!externalId) {
          continue;
        }

        const result = this.provisionUser(idp.id, externalId, { ...rawAttributes, email: email || rawAttributes['email'] });
        const session = this.bindSession(result.user.id, idp.id, rawAttributes['sessionIndex'] as string);

        return {
          success: true,
          user: result.user,
          session,
          idpId: idp.id,
          protocol: idp.protocol,
          usedFallback: false,
        };
      } catch (err) {
        logger.warn('IdP authentication attempt failed, trying next', {
          idpId: idp.id,
          error: (err as Error).message,
        });
      }
    }

    // Fallback: try unavailable IdPs with relaxed checks
    const unavailableIdPs = matchingIdPs.filter((idp) => {
      const health = this.healthStatuses.get(idp.id);
      return health && health.status === 'unavailable';
    });

    for (const idp of unavailableIdPs) {
      const email = emailOrDomain.includes('@') ? emailOrDomain : '';
      if (email) {
        const userId = this.emailUserIndex.get(email);
        if (userId) {
          const user = this.users.get(userId)!;
          const session = this.bindSession(user.id, idp.id);
          logger.warn('Fallback auth used for unavailable IdP', { idpId: idp.id, userId: user.id });
          return {
            success: true,
            user,
            session,
            idpId: idp.id,
            protocol: idp.protocol,
            usedFallback: true,
          };
        }
      }
    }

    return {
      success: false,
      idpId: matchingIdPs[0]?.id ?? '',
      protocol: matchingIdPs[0]?.protocol ?? 'oidc',
      usedFallback: false,
      error: 'Authentication failed across all configured IdPs',
    };
  }

  resolveIdPForDomain(tenantId: string, domain: string): IdPConfig | null {
    const idps = this.getTenantIdPs(tenantId);
    return (
      idps.find(
        (idp) =>
          idp.enabled &&
          idp.allowedDomains.includes(domain) &&
          this.healthStatuses.get(idp.id)?.status !== 'unavailable',
      ) ?? null
    );
  }

  getStats(): {
    totalIdPs: number;
    totalUsers: number;
    activeSessions: number;
    idpsByStatus: Record<IdPStatus, number>;
  } {
    const idpsByStatus: Record<IdPStatus, number> = { active: 0, degraded: 0, unavailable: 0, maintenance: 0 };
    for (const health of this.healthStatuses.values()) {
      idpsByStatus[health.status]++;
    }
    return {
      totalIdPs: this.idpConfigs.size,
      totalUsers: this.users.size,
      activeSessions: Array.from(this.sessions.values()).filter((s) => s.active).length,
      idpsByStatus,
    };
  }

  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__ssoFederationManager__';

export function getSSOFederationManager(): SSOFederationManager {
  const g = globalThis as unknown as Record<string, SSOFederationManager>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new SSOFederationManager();
  }
  return g[GLOBAL_KEY];
}

export type {
  IdPConfig,
  IdPProtocol,
  IdPStatus,
  AttributeMapping,
  FederationMetadata,
  FederatedUser,
  IdPSession,
  IdPHealthStatus,
  JITProvisioningResult,
  AuthenticationResult,
};
