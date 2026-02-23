import crypto from 'crypto';
import { logger } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  token: string;
  userId: string;
  fingerprint: string;
  deviceInfo: DeviceInfo;
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string;
  refreshedAt: string | null;
  status: SessionStatus;
  tier: string;
  metadata: Record<string, unknown>;
}

export type SessionStatus = 'active' | 'idle' | 'expired' | 'revoked';

export interface DeviceInfo {
  userAgent: string;
  ip: string;
  platform: string;
  browser: string;
}

export interface SessionConfig {
  maxSessionDurationMs: number;
  idleTimeoutMs: number;
  refreshWindowMs: number;
  tokenLength: number;
}

export interface TierLimits {
  [tier: string]: number;
}

export interface SessionActivity {
  sessionId: string;
  action: string;
  timestamp: string;
  ip: string;
  path: string;
}

export interface SessionValidationResult {
  valid: boolean;
  session: Session | null;
  reason?: string;
}

export interface SessionListResult {
  sessions: Session[];
  total: number;
  activeSessions: number;
}

export interface RevocationResult {
  revokedCount: number;
  sessionIds: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SessionConfig = {
  maxSessionDurationMs: 24 * 60 * 60 * 1000, // 24 hours
  idleTimeoutMs: 30 * 60 * 1000,             // 30 minutes
  refreshWindowMs: 5 * 60 * 1000,            // 5 minutes before expiry
  tokenLength: 48,
};

const DEFAULT_TIER_LIMITS: TierLimits = {
  free: 2,
  pro: 5,
  enterprise: 20,
};

// ─── Service ──────────────────────────────────────────────────────────────────

export class SessionManagementService {
  private sessions: Map<string, Session> = new Map();
  private tokenIndex: Map<string, string> = new Map(); // token -> sessionId
  private userSessions: Map<string, Set<string>> = new Map(); // userId -> sessionIds
  private activities: Map<string, SessionActivity[]> = new Map();
  private config: SessionConfig;
  private tierLimits: TierLimits;
  private log = logger.child({ service: 'SessionManagementService' });

  constructor(config?: Partial<SessionConfig>, tierLimits?: TierLimits) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tierLimits = { ...DEFAULT_TIER_LIMITS, ...tierLimits };
  }

  // ─── Session Creation ─────────────────────────────────────────────────────

  createSession(
    userId: string,
    deviceInfo: DeviceInfo,
    tier: string = 'free',
    metadata: Record<string, unknown> = {},
  ): Session {
    // Enforce concurrent session limits
    this.enforceSessionLimit(userId, tier);

    const id = crypto.randomUUID();
    const token = this.generateSecureToken();
    const now = new Date();
    const fingerprint = this.generateFingerprint(deviceInfo);

    const session: Session = {
      id,
      token,
      userId,
      fingerprint,
      deviceInfo,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.config.maxSessionDurationMs).toISOString(),
      lastActivityAt: now.toISOString(),
      refreshedAt: null,
      status: 'active',
      tier,
      metadata,
    };

    this.sessions.set(id, session);
    this.tokenIndex.set(token, id);

    const userSet = this.userSessions.get(userId) ?? new Set();
    userSet.add(id);
    this.userSessions.set(userId, userSet);

    this.log.info('Session created', { sessionId: id, userId, tier });
    return session;
  }

  private enforceSessionLimit(userId: string, tier: string): void {
    const limit = this.tierLimits[tier] ?? DEFAULT_TIER_LIMITS.free;
    const userSet = this.userSessions.get(userId);
    if (!userSet) return;

    const activeSessions = [...userSet]
      .map(id => this.sessions.get(id))
      .filter((s): s is Session => s !== undefined && s.status === 'active');

    if (activeSessions.length >= limit) {
      // Revoke oldest session to make room
      const oldest = activeSessions.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )[0];
      if (oldest) {
        this.revokeSession(oldest.id, 'concurrent_limit_exceeded');
        this.log.info('Oldest session revoked for limit enforcement', {
          userId,
          revokedSessionId: oldest.id,
        });
      }
    }
  }

  // ─── Token Generation ─────────────────────────────────────────────────────

  private generateSecureToken(): string {
    return crypto.randomBytes(this.config.tokenLength).toString('base64url');
  }

  // ─── Session Fingerprinting ───────────────────────────────────────────────

  private generateFingerprint(deviceInfo: DeviceInfo): string {
    const raw = `${deviceInfo.userAgent}|${deviceInfo.ip}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  validateFingerprint(session: Session, deviceInfo: DeviceInfo): boolean {
    const currentFingerprint = this.generateFingerprint(deviceInfo);
    return session.fingerprint === currentFingerprint;
  }

  // ─── Session Validation ───────────────────────────────────────────────────

  validateSession(token: string, deviceInfo?: DeviceInfo): SessionValidationResult {
    const sessionId = this.tokenIndex.get(token);
    if (!sessionId) {
      return { valid: false, session: null, reason: 'invalid_token' };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return { valid: false, session: null, reason: 'session_not_found' };
    }

    if (session.status === 'revoked') {
      return { valid: false, session, reason: 'session_revoked' };
    }

    const now = Date.now();

    // Check absolute expiry
    if (now > new Date(session.expiresAt).getTime()) {
      session.status = 'expired';
      return { valid: false, session, reason: 'session_expired' };
    }

    // Check idle timeout
    const idleTime = now - new Date(session.lastActivityAt).getTime();
    if (idleTime > this.config.idleTimeoutMs) {
      session.status = 'idle';
      return { valid: false, session, reason: 'idle_timeout' };
    }

    // Check fingerprint if device info provided
    if (deviceInfo && !this.validateFingerprint(session, deviceInfo)) {
      this.log.warn('Session fingerprint mismatch', { sessionId: session.id, userId: session.userId });
      return { valid: false, session, reason: 'fingerprint_mismatch' };
    }

    // Update last activity
    session.lastActivityAt = new Date().toISOString();
    session.status = 'active';

    return { valid: true, session };
  }

  // ─── Session Refresh ──────────────────────────────────────────────────────

  refreshSession(token: string): Session | null {
    const sessionId = this.tokenIndex.get(token);
    if (!sessionId) return null;

    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'active') return null;

    const now = Date.now();
    const expiresAt = new Date(session.expiresAt).getTime();
    const withinRefreshWindow = expiresAt - now <= this.config.refreshWindowMs;

    if (!withinRefreshWindow) return session;

    // Generate new token
    const oldToken = session.token;
    const newToken = this.generateSecureToken();

    session.token = newToken;
    session.expiresAt = new Date(now + this.config.maxSessionDurationMs).toISOString();
    session.refreshedAt = new Date().toISOString();
    session.lastActivityAt = new Date().toISOString();

    this.tokenIndex.delete(oldToken);
    this.tokenIndex.set(newToken, sessionId);

    this.log.info('Session refreshed', { sessionId, userId: session.userId });
    return session;
  }

  // ─── Session Revocation ───────────────────────────────────────────────────

  revokeSession(sessionId: string, reason: string = 'manual'): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === 'revoked') return false;

    session.status = 'revoked';
    this.tokenIndex.delete(session.token);

    this.log.info('Session revoked', { sessionId, userId: session.userId, reason });
    return true;
  }

  revokeAllUserSessions(userId: string, reason: string = 'manual'): RevocationResult {
    const userSet = this.userSessions.get(userId);
    if (!userSet) return { revokedCount: 0, sessionIds: [] };

    const revokedIds: string[] = [];
    for (const sessionId of userSet) {
      if (this.revokeSession(sessionId, reason)) {
        revokedIds.push(sessionId);
      }
    }

    this.log.info('All user sessions revoked', { userId, count: revokedIds.length, reason });
    return { revokedCount: revokedIds.length, sessionIds: revokedIds };
  }

  revokeSelectiveSessions(
    userId: string,
    filter: (session: Session) => boolean,
    reason: string = 'selective',
  ): RevocationResult {
    const userSet = this.userSessions.get(userId);
    if (!userSet) return { revokedCount: 0, sessionIds: [] };

    const revokedIds: string[] = [];
    for (const sessionId of userSet) {
      const session = this.sessions.get(sessionId);
      if (session && session.status === 'active' && filter(session)) {
        if (this.revokeSession(sessionId, reason)) {
          revokedIds.push(sessionId);
        }
      }
    }

    return { revokedCount: revokedIds.length, sessionIds: revokedIds };
  }

  revokeByFingerprint(userId: string, fingerprint: string): RevocationResult {
    return this.revokeSelectiveSessions(
      userId,
      s => s.fingerprint === fingerprint,
      'fingerprint_revocation',
    );
  }

  // ─── Multi-Device Tracking ────────────────────────────────────────────────

  getUserSessions(userId: string): SessionListResult {
    const userSet = this.userSessions.get(userId);
    if (!userSet) return { sessions: [], total: 0, activeSessions: 0 };

    const sessions: Session[] = [];
    let activeSessions = 0;

    for (const sessionId of userSet) {
      const session = this.sessions.get(sessionId);
      if (session) {
        sessions.push(session);
        if (session.status === 'active') activeSessions++;
      }
    }

    sessions.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

    return { sessions, total: sessions.length, activeSessions };
  }

  getSessionById(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getSessionByToken(token: string): Session | null {
    const sessionId = this.tokenIndex.get(token);
    if (!sessionId) return null;
    return this.sessions.get(sessionId) ?? null;
  }

  // ─── Activity Tracking ────────────────────────────────────────────────────

  recordActivity(sessionId: string, action: string, ip: string, path: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'active') return false;

    const activity: SessionActivity = {
      sessionId,
      action,
      timestamp: new Date().toISOString(),
      ip,
      path,
    };

    const sessionActivities = this.activities.get(sessionId) ?? [];
    sessionActivities.push(activity);

    // Keep only last 1000 activities per session
    if (sessionActivities.length > 1000) {
      sessionActivities.splice(0, sessionActivities.length - 1000);
    }

    this.activities.set(sessionId, sessionActivities);
    session.lastActivityAt = activity.timestamp;

    return true;
  }

  getSessionActivities(sessionId: string, limit: number = 50): SessionActivity[] {
    const activities = this.activities.get(sessionId) ?? [];
    return activities.slice(-limit);
  }

  // ─── Idle Session Cleanup ─────────────────────────────────────────────────

  cleanupExpiredSessions(): RevocationResult {
    const now = Date.now();
    const revokedIds: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.status === 'revoked') continue;

      const isExpired = now > new Date(session.expiresAt).getTime();
      const isIdle = now - new Date(session.lastActivityAt).getTime() > this.config.idleTimeoutMs;

      if (isExpired || isIdle) {
        session.status = isExpired ? 'expired' : 'idle';
        this.tokenIndex.delete(session.token);
        revokedIds.push(sessionId);
      }
    }

    if (revokedIds.length > 0) {
      this.log.info('Expired sessions cleaned up', { count: revokedIds.length });
    }
    return { revokedCount: revokedIds.length, sessionIds: revokedIds };
  }

  // ─── Tier Management ──────────────────────────────────────────────────────

  setTierLimit(tier: string, maxSessions: number): void {
    this.tierLimits[tier] = maxSessions;
  }

  getTierLimit(tier: string): number {
    return this.tierLimits[tier] ?? DEFAULT_TIER_LIMITS.free;
  }

  updateSessionConfig(updates: Partial<SessionConfig>): void {
    this.config = { ...this.config, ...updates };
    this.log.info('Session config updated', { config: this.config });
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  getStats(): {
    totalSessions: number;
    activeSessions: number;
    idleSessions: number;
    expiredSessions: number;
    revokedSessions: number;
    uniqueUsers: number;
  } {
    let active = 0;
    let idle = 0;
    let expired = 0;
    let revoked = 0;

    for (const session of this.sessions.values()) {
      switch (session.status) {
        case 'active': active++; break;
        case 'idle': idle++; break;
        case 'expired': expired++; break;
        case 'revoked': revoked++; break;
      }
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions: active,
      idleSessions: idle,
      expiredSessions: expired,
      revokedSessions: revoked,
      uniqueUsers: this.userSessions.size,
    };
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

declare const globalThis: Record<string, unknown> & typeof global;

export function getSessionManagementService(): SessionManagementService {
  if (!globalThis.__sessionManagementService__) {
    globalThis.__sessionManagementService__ = new SessionManagementService();
  }
  return globalThis.__sessionManagementService__ as SessionManagementService;
}
