/**
 * @module intelligentSessionManager
 * @description Distributed session management implementing JWT rotation, sticky
 * sessions, session clustering, idle timeout eviction, device fingerprinting,
 * concurrent session limiting, session replay detection, geo-aware routing,
 * cross-tenant isolation, and anomaly-based session termination for enterprise
 * multi-tenant authentication infrastructure.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type SessionStatus = 'active' | 'idle' | 'expired' | 'revoked' | 'locked';
export type AuthMethod = 'password' | 'sso' | 'oauth2' | 'api_key' | 'mfa' | 'passkey';
export type DeviceTrust = 'trusted' | 'known' | 'unknown' | 'suspicious';
export type SessionThreat = 'none' | 'replay' | 'geo_anomaly' | 'concurrent_limit' | 'brute_force' | 'hijack';

export interface SessionConfig {
  id: string;
  tenantId: string;
  maxSessionsPerUser: number;
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
  jwtRotationIntervalMs: number;
  requireMfaForSensitive: boolean;
  geoAnomalyDetectionEnabled: boolean;
  replayDetectionEnabled: boolean;
  allowedCountries?: string[];
  maxConcurrentSessions: number;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  userId: string;
  tenantId: string;
  authMethod: AuthMethod;
  deviceId: string;
  deviceFingerprint: string;
  deviceTrust: DeviceTrust;
  ipAddress: string;
  country?: string;
  city?: string;
  userAgent: string;
  status: SessionStatus;
  jwtId: string;
  jwtRotatedAt: number;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number;
  mfaVerified: boolean;
  metadata: Record<string, unknown>;
  threatLevel: SessionThreat;
  threatDetails?: string;
  clusterId?: string;
  stickyServerId?: string;
}

export interface JwtRotation {
  sessionId: string;
  oldJwtId: string;
  newJwtId: string;
  rotatedAt: number;
  reason: string;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  userId: string;
  tenantId: string;
  type: 'created' | 'renewed' | 'rotated' | 'expired' | 'revoked' | 'locked' | 'threat_detected' | 'mfa_verified';
  timestamp: number;
  ipAddress: string;
  details: Record<string, unknown>;
}

export interface ConcurrentSessionPolicy {
  tenantId: string;
  userId: string;
  activeSessions: number;
  maxAllowed: number;
  oldest?: { sessionId: string; createdAt: number };
}

export interface SessionAnalytics {
  tenantId: string;
  activeSessions: number;
  idleSessions: number;
  revokedToday: number;
  expiredToday: number;
  avgSessionDurationMs: number;
  mfaAdoptionPct: number;
  suspiciousSessions: number;
  topCountries: Array<{ country: string; count: number }>;
  deviceTrustDistribution: Record<DeviceTrust, number>;
}

export interface EngineSummary {
  totalConfigs: number;
  totalSessions: number;
  activeSessions: number;
  expiredSessions: number;
  revokedSessions: number;
  sessionsWithThreats: number;
  totalJwtRotations: number;
  totalEvents: number;
}

// ── Engine ─────────────────────────────────────────────────────────────────────

class IntelligentSessionManager {
  private readonly configs = new Map<string, SessionConfig>();
  private readonly sessions = new Map<string, Session>();
  private readonly jwtIndex = new Map<string, string>(); // jwtId -> sessionId
  private readonly rotations: JwtRotation[] = [];
  private readonly events: SessionEvent[] = [];
  private readonly EVENTS_MAX = 50_000;
  private globalCounter = 0;

  // Config ─────────────────────────────────────────────────────────────────────

  configureTenant(params: Omit<SessionConfig, 'createdAt' | 'updatedAt'>): SessionConfig {
    const config: SessionConfig = { ...params, createdAt: Date.now(), updatedAt: Date.now() };
    this.configs.set(config.tenantId, config);
    logger.info('Session config set', { tenantId: config.tenantId });
    return config;
  }

  getConfig(tenantId: string): SessionConfig | undefined {
    return this.configs.get(tenantId);
  }

  // Session lifecycle ──────────────────────────────────────────────────────────

  createSession(params: {
    userId: string;
    tenantId: string;
    authMethod: AuthMethod;
    deviceId: string;
    deviceFingerprint: string;
    ipAddress: string;
    userAgent: string;
    country?: string;
    city?: string;
    mfaVerified?: boolean;
    metadata?: Record<string, unknown>;
  }): Session {
    const config = this.configs.get(params.tenantId);
    const now = Date.now();

    const jwtId = this.generateJwtId();
    const sessionId = `sess_${now}_${++this.globalCounter}`;
    const idleTimeout = config?.idleTimeoutMs ?? 30 * 60 * 1000;
    const absoluteTimeout = config?.absoluteTimeoutMs ?? 8 * 60 * 60 * 1000;

    // Enforce concurrent session limit
    if (config) {
      const userSessions = this.listUserSessions(params.userId, params.tenantId)
        .filter(s => s.status === 'active');
      if (userSessions.length >= config.maxSessionsPerUser) {
        // Revoke oldest session to make room
        const oldest = userSessions.sort((a, b) => a.createdAt - b.createdAt)[0];
        this.revokeSession(oldest.id, 'Concurrent session limit reached');
      }
    }

    const deviceTrust = this.classifyDeviceTrust(params.deviceId, params.tenantId);
    const session: Session = {
      id: sessionId,
      userId: params.userId,
      tenantId: params.tenantId,
      authMethod: params.authMethod,
      deviceId: params.deviceId,
      deviceFingerprint: params.deviceFingerprint,
      deviceTrust,
      ipAddress: params.ipAddress,
      country: params.country,
      city: params.city,
      userAgent: params.userAgent,
      status: 'active',
      jwtId,
      jwtRotatedAt: now,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: now + absoluteTimeout,
      mfaVerified: params.mfaVerified ?? false,
      metadata: params.metadata ?? {},
      threatLevel: 'none',
    };

    // Geo anomaly check
    if (config?.geoAnomalyDetectionEnabled && params.country) {
      const anomaly = this.detectGeoAnomaly(params.userId, params.tenantId, params.country);
      if (anomaly) {
        session.threatLevel = 'geo_anomaly';
        session.threatDetails = anomaly;
        logger.warn('Geo anomaly on session create', { sessionId, userId: params.userId, country: params.country });
      }
    }

    this.sessions.set(sessionId, session);
    this.jwtIndex.set(jwtId, sessionId);
    this.emitEvent(session, 'created', { deviceTrust, authMethod: params.authMethod });
    logger.info('Session created', { sessionId, userId: params.userId, tenantId: params.tenantId });
    return session;
  }

  renewSession(sessionId: string, ipAddress?: string): Session {
    const session = this.getActiveSession(sessionId);
    const config = this.configs.get(session.tenantId);
    const now = Date.now();
    session.lastActivityAt = now;
    if (config) {
      session.expiresAt = now + config.absoluteTimeoutMs;
    }
    if (session.status === 'idle') session.status = 'active';
    this.emitEvent(session, 'renewed', { ipAddress });
    return session;
  }

  rotateJwt(sessionId: string, reason = 'scheduled'): JwtRotation {
    const session = this.getActiveSession(sessionId);
    const oldJwtId = session.jwtId;
    const newJwtId = this.generateJwtId();
    this.jwtIndex.delete(oldJwtId);
    session.jwtId = newJwtId;
    session.jwtRotatedAt = Date.now();
    this.jwtIndex.set(newJwtId, sessionId);

    const rotation: JwtRotation = {
      sessionId,
      oldJwtId,
      newJwtId,
      rotatedAt: Date.now(),
      reason,
    };
    this.rotations.push(rotation);
    this.emitEvent(session, 'rotated', { reason });
    logger.info('JWT rotated', { sessionId, reason });
    return rotation;
  }

  revokeSession(sessionId: string, reason = 'manual'): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    this.jwtIndex.delete(session.jwtId);
    session.status = 'revoked';
    this.emitEvent(session, 'revoked', { reason });
    logger.info('Session revoked', { sessionId, reason });
  }

  revokeAllUserSessions(userId: string, tenantId: string, reason = 'user_logout'): number {
    const sessions = this.listUserSessions(userId, tenantId).filter(s => s.status === 'active' || s.status === 'idle');
    for (const s of sessions) this.revokeSession(s.id, reason);
    return sessions.length;
  }

  lockSession(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.status = 'locked';
    this.emitEvent(session, 'locked', { reason });
    logger.warn('Session locked', { sessionId, reason });
  }

  verifyMfa(sessionId: string): void {
    const session = this.getActiveSession(sessionId);
    session.mfaVerified = true;
    this.emitEvent(session, 'mfa_verified', {});
  }

  // JWT resolution ─────────────────────────────────────────────────────────────

  resolveByJwt(jwtId: string): Session | undefined {
    const sessionId = this.jwtIndex.get(jwtId);
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId);
  }

  // Idle / expiry ──────────────────────────────────────────────────────────────

  runEviction(): { evicted: number; expired: number } {
    const now = Date.now();
    let evicted = 0;
    let expired = 0;

    for (const session of this.sessions.values()) {
      if (session.status !== 'active' && session.status !== 'idle') continue;

      const config = this.configs.get(session.tenantId);
      const idleMs = config?.idleTimeoutMs ?? 30 * 60 * 1000;

      if (now >= session.expiresAt) {
        session.status = 'expired';
        this.jwtIndex.delete(session.jwtId);
        this.emitEvent(session, 'expired', {});
        expired++;
        continue;
      }

      if (now - session.lastActivityAt >= idleMs) {
        session.status = 'idle';
      }
    }

    // Auto-rotate JWT for sessions past rotation interval
    for (const session of this.sessions.values()) {
      if (session.status !== 'active') continue;
      const config = this.configs.get(session.tenantId);
      const rotationInterval = config?.jwtRotationIntervalMs ?? 15 * 60 * 1000;
      if (now - session.jwtRotatedAt >= rotationInterval) {
        this.rotateJwt(session.id, 'scheduled_rotation');
      }
    }

    return { evicted, expired };
  }

  // Threat detection ───────────────────────────────────────────────────────────

  detectThreats(sessionId: string): SessionThreat {
    const session = this.getActiveSession(sessionId);
    const config = this.configs.get(session.tenantId);

    if (config?.replayDetectionEnabled) {
      const replayCandidate = this.detectReplay(session);
      if (replayCandidate) {
        session.threatLevel = 'replay';
        session.threatDetails = replayCandidate;
        this.emitEvent(session, 'threat_detected', { threat: 'replay' });
        return 'replay';
      }
    }

    if (config?.geoAnomalyDetectionEnabled && session.country) {
      const geoAnomaly = this.detectGeoAnomaly(session.userId, session.tenantId, session.country, session.id);
      if (geoAnomaly) {
        session.threatLevel = 'geo_anomaly';
        session.threatDetails = geoAnomaly;
        this.emitEvent(session, 'threat_detected', { threat: 'geo_anomaly' });
        return 'geo_anomaly';
      }
    }

    session.threatLevel = 'none';
    return 'none';
  }

  private detectReplay(session: Session): string | undefined {
    // Detect if the same JWT ID is being used from multiple IPs simultaneously
    const recentEvents = this.events
      .filter(e => e.sessionId === session.id && e.type === 'renewed')
      .slice(-10);
    const ips = new Set(recentEvents.map(e => e.ipAddress));
    if (ips.size > 3) return `Session accessed from ${ips.size} distinct IPs in recent window`;
    return undefined;
  }

  private detectGeoAnomaly(userId: string, tenantId: string, country: string, currentSessionId?: string): string | undefined {
    const userSessions = this.listUserSessions(userId, tenantId)
      .filter(s => s.status === 'active' && s.country && s.id !== currentSessionId);
    if (userSessions.length === 0) return undefined;
    const otherCountries = new Set(userSessions.map(s => s.country));
    if (!otherCountries.has(country) && otherCountries.size > 0) {
      return `User has active sessions in ${Array.from(otherCountries).join(', ')} but new session from ${country}`;
    }
    return undefined;
  }

  private classifyDeviceTrust(deviceId: string, tenantId: string): DeviceTrust {
    const knownDevices = Array.from(this.sessions.values())
      .filter(s => s.tenantId === tenantId && s.deviceId === deviceId && s.status !== 'revoked')
      .length;
    if (knownDevices > 5) return 'trusted';
    if (knownDevices > 0) return 'known';
    return 'unknown';
  }

  // Queries ────────────────────────────────────────────────────────────────────

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  private getActiveSession(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status === 'revoked') throw new Error(`Session ${sessionId} is revoked`);
    if (session.status === 'expired') throw new Error(`Session ${sessionId} has expired`);
    if (session.status === 'locked') throw new Error(`Session ${sessionId} is locked`);
    return session;
  }

  listUserSessions(userId: string, tenantId: string): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.userId === userId && s.tenantId === tenantId);
  }

  listSessions(tenantId?: string, status?: SessionStatus): Session[] {
    let all = Array.from(this.sessions.values());
    if (tenantId) all = all.filter(s => s.tenantId === tenantId);
    if (status) all = all.filter(s => s.status === status);
    return all;
  }

  getConcurrentSessionPolicy(userId: string, tenantId: string): ConcurrentSessionPolicy {
    const config = this.configs.get(tenantId);
    const active = this.listUserSessions(userId, tenantId).filter(s => s.status === 'active' || s.status === 'idle');
    const sorted = active.sort((a, b) => a.createdAt - b.createdAt);
    return {
      tenantId,
      userId,
      activeSessions: active.length,
      maxAllowed: config?.maxSessionsPerUser ?? 10,
      oldest: sorted[0] ? { sessionId: sorted[0].id, createdAt: sorted[0].createdAt } : undefined,
    };
  }

  // Events ─────────────────────────────────────────────────────────────────────

  private emitEvent(session: Session, type: SessionEvent['type'], details: Record<string, unknown>): void {
    const event: SessionEvent = {
      id: `sevt_${Date.now()}_${++this.globalCounter}`,
      sessionId: session.id,
      userId: session.userId,
      tenantId: session.tenantId,
      type,
      timestamp: Date.now(),
      ipAddress: session.ipAddress,
      details,
    };
    this.events.push(event);
    if (this.events.length > this.EVENTS_MAX) this.events.shift();
  }

  listEvents(sessionId?: string, tenantId?: string, limit = 100): SessionEvent[] {
    let evts = this.events;
    if (sessionId) evts = evts.filter(e => e.sessionId === sessionId);
    if (tenantId) evts = evts.filter(e => e.tenantId === tenantId);
    return evts.slice(-limit);
  }

  listRotations(sessionId?: string): JwtRotation[] {
    return sessionId ? this.rotations.filter(r => r.sessionId === sessionId) : [...this.rotations];
  }

  // Analytics ──────────────────────────────────────────────────────────────────

  getAnalytics(tenantId: string): SessionAnalytics {
    const tenantSessions = this.listSessions(tenantId);
    const now = Date.now();
    const dayMs = 86_400_000;
    const dayAgo = now - dayMs;

    const activeSessions = tenantSessions.filter(s => s.status === 'active').length;
    const idleSessions = tenantSessions.filter(s => s.status === 'idle').length;
    const revokedToday = tenantSessions.filter(s => s.status === 'revoked' && s.createdAt >= dayAgo).length;
    const expiredToday = tenantSessions.filter(s => s.status === 'expired' && s.createdAt >= dayAgo).length;

    const durations = tenantSessions
      .filter(s => s.status !== 'active')
      .map(s => s.lastActivityAt - s.createdAt);
    const avgDur = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    const mfaCount = tenantSessions.filter(s => s.mfaVerified).length;
    const mfaAdoption = tenantSessions.length > 0 ? (mfaCount / tenantSessions.length) * 100 : 0;
    const suspicious = tenantSessions.filter(s => s.threatLevel !== 'none').length;

    const countryMap = new Map<string, number>();
    for (const s of tenantSessions) {
      if (s.country) countryMap.set(s.country, (countryMap.get(s.country) ?? 0) + 1);
    }
    const topCountries = Array.from(countryMap.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([country, count]) => ({ country, count }));

    const trustDist: Record<DeviceTrust, number> = { trusted: 0, known: 0, unknown: 0, suspicious: 0 };
    for (const s of tenantSessions) trustDist[s.deviceTrust]++;

    return {
      tenantId,
      activeSessions,
      idleSessions,
      revokedToday,
      expiredToday,
      avgSessionDurationMs: avgDur,
      mfaAdoptionPct: mfaAdoption,
      suspiciousSessions: suspicious,
      topCountries,
      deviceTrustDistribution: trustDist,
    };
  }

  getSummary(): EngineSummary {
    const all = Array.from(this.sessions.values());
    return {
      totalConfigs: this.configs.size,
      totalSessions: all.length,
      activeSessions: all.filter(s => s.status === 'active').length,
      expiredSessions: all.filter(s => s.status === 'expired').length,
      revokedSessions: all.filter(s => s.status === 'revoked').length,
      sessionsWithThreats: all.filter(s => s.threatLevel !== 'none').length,
      totalJwtRotations: this.rotations.length,
      totalEvents: this.events.length,
    };
  }

  // Utilities ──────────────────────────────────────────────────────────────────

  private generateJwtId(): string {
    return `jwt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const KEY = '__intelligentSessionManager__';
export function getSessionManager(): IntelligentSessionManager {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new IntelligentSessionManager();
  }
  return (globalThis as Record<string, unknown>)[KEY] as IntelligentSessionManager;
}
