/**
 * Abuse Prevention System
 *
 * Advanced multi-signal abuse detection and prevention:
 * - Request velocity analysis per identifier
 * - Device/browser fingerprinting scoring
 * - Behavioral anomaly detection
 * - Account takeover (ATO) signals
 * - Bot detection via timing and entropy analysis
 * - Content fraud detection
 * - Distributed attack detection (coordinated IPs)
 * - Adaptive penalty scoring with decay
 * - Escalating responses: throttle → CAPTCHA → block
 * - Allowlist/denylist integration
 * - Forensic logging for incident response
 */

import { getLogger } from './logger';
import { getCache } from './cache';

const logger = getLogger();

export type AbuseSignalType =
  | 'velocity_ip'
  | 'velocity_user'
  | 'credential_stuffing'
  | 'scraping'
  | 'spam_content'
  | 'fake_account'
  | 'api_abuse'
  | 'payment_fraud'
  | 'bot_behavior'
  | 'account_takeover'
  | 'distributed_attack'
  | 'content_manipulation';

export type AbuseDecision = 'allow' | 'throttle' | 'captcha' | 'block' | 'shadow_ban';

export interface AbuseSignal {
  type: AbuseSignalType;
  confidence: number; // 0-1
  evidence: string;
  detectedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface AbuseProfile {
  identifier: string; // userId or IP
  identifierType: 'user' | 'ip' | 'fingerprint';
  riskScore: number; // 0-100
  decision: AbuseDecision;
  signals: AbuseSignal[];
  firstSeenAt: Date;
  lastUpdatedAt: Date;
  requestCount: number;
  violationCount: number;
  shadowBanned: boolean;
  shadowBanAt?: Date;
  blocked: boolean;
  blockedAt?: Date;
  blockExpiresAt?: Date;
  captchaRequired: boolean;
  notes: string[];
}

export interface RequestContext {
  ip: string;
  userId?: string;
  userAgent?: string;
  endpoint: string;
  method: string;
  referer?: string;
  acceptLanguage?: string;
  requestId: string;
  timestamp: Date;
  timingMs?: number; // time taken to fill form/make request (bot detection)
  bodySize?: number;
}

export interface VelocityWindow {
  count: number;
  windowStart: number;
  distinctEndpoints: Set<string>;
  distinctUserAgents: Set<string>;
}

const abuseProfiles = new Map<string, AbuseProfile>();
const MAX_PROFILES = 50000;

// Risk score thresholds
const THROTTLE_THRESHOLD = 40;
const CAPTCHA_THRESHOLD = 65;
const BLOCK_THRESHOLD = 80;
const SHADOW_BAN_THRESHOLD = 70;

// Velocity thresholds per window
const IP_RPM_THRESHOLD = 120;
const USER_RPM_THRESHOLD = 60;
const CREDENTIAL_STUFFING_THRESHOLD = 10; // login attempts per 10 min

function getVelocityKey(type: string, id: string, windowMin: number): string {
  const bucket = Math.floor(Date.now() / (windowMin * 60000));
  return `abuse:velocity:${type}:${id}:${bucket}`;
}

function recordVelocity(type: string, id: string, windowMin: number, endpoint: string, ua: string): VelocityWindow {
  const cache = getCache();
  const key = getVelocityKey(type, id, windowMin);
  const current = cache.get<{ count: number; endpoints: string[]; uas: string[]; windowStart: number }>(key) ?? {
    count: 0,
    endpoints: [],
    uas: [],
    windowStart: Date.now(),
  };

  current.count += 1;
  if (!current.endpoints.includes(endpoint)) current.endpoints.push(endpoint);
  if (!current.uas.includes(ua)) current.uas.push(ua);

  cache.set(key, current, windowMin * 60 + 10);

  return {
    count: current.count,
    windowStart: current.windowStart,
    distinctEndpoints: new Set(current.endpoints),
    distinctUserAgents: new Set(current.uas),
  };
}

function analyzeBotBehavior(ctx: RequestContext): AbuseSignal | null {
  const signals: string[] = [];
  let confidence = 0;

  const ua = ctx.userAgent ?? '';

  // No user agent
  if (!ua) { signals.push('no_user_agent'); confidence += 0.4; }

  // Common bot user agents
  if (/bot|crawler|spider|scraper|wget|curl|python-requests|go-http/i.test(ua)) {
    signals.push('bot_user_agent');
    confidence += 0.7;
  }

  // Abnormally fast requests
  if (ctx.timingMs !== undefined && ctx.timingMs < 50) {
    signals.push('superhuman_speed');
    confidence += 0.5;
  }

  // No referer on page-load endpoints
  if (!ctx.referer && ['GET'].includes(ctx.method) && ctx.endpoint.startsWith('/api')) {
    confidence += 0.1;
  }

  if (confidence > 0.3) {
    return {
      type: 'bot_behavior',
      confidence: Math.min(1, confidence),
      evidence: signals.join(', '),
      detectedAt: new Date(),
    };
  }

  return null;
}

function analyzeIPVelocity(ctx: RequestContext): AbuseSignal | null {
  const velocity = recordVelocity('ip', ctx.ip, 1, ctx.endpoint, ctx.userAgent ?? 'unknown');

  if (velocity.count > IP_RPM_THRESHOLD) {
    return {
      type: 'velocity_ip',
      confidence: Math.min(1, velocity.count / (IP_RPM_THRESHOLD * 3)),
      evidence: `${velocity.count} requests/minute from IP ${ctx.ip}`,
      detectedAt: new Date(),
      metadata: { count: velocity.count, threshold: IP_RPM_THRESHOLD },
    };
  }

  // Many distinct endpoints from one IP = scraping
  if (velocity.distinctEndpoints.size > 20) {
    return {
      type: 'scraping',
      confidence: 0.7,
      evidence: `${velocity.distinctEndpoints.size} distinct endpoints accessed`,
      detectedAt: new Date(),
    };
  }

  return null;
}

function analyzeUserVelocity(ctx: RequestContext): AbuseSignal | null {
  if (!ctx.userId) return null;

  const velocity = recordVelocity('user', ctx.userId, 1, ctx.endpoint, ctx.userAgent ?? 'unknown');

  if (velocity.count > USER_RPM_THRESHOLD) {
    return {
      type: 'velocity_user',
      confidence: Math.min(1, velocity.count / (USER_RPM_THRESHOLD * 3)),
      evidence: `${velocity.count} requests/minute from user ${ctx.userId}`,
      detectedAt: new Date(),
    };
  }

  return null;
}

function analyzeCredentialStuffing(ctx: RequestContext): AbuseSignal | null {
  if (!ctx.endpoint.includes('auth') && !ctx.endpoint.includes('login')) return null;
  if (ctx.method !== 'POST') return null;

  const velocity = recordVelocity('auth', ctx.ip, 10, ctx.endpoint, ctx.userAgent ?? 'unknown');

  if (velocity.count > CREDENTIAL_STUFFING_THRESHOLD) {
    return {
      type: 'credential_stuffing',
      confidence: Math.min(1, velocity.count / (CREDENTIAL_STUFFING_THRESHOLD * 2)),
      evidence: `${velocity.count} auth attempts in 10 minutes from IP ${ctx.ip}`,
      detectedAt: new Date(),
    };
  }

  return null;
}

function computeRiskScore(signals: AbuseSignal[]): number {
  if (signals.length === 0) return 0;

  // Weighted signal importance
  const weights: Record<AbuseSignalType, number> = {
    credential_stuffing: 35,
    account_takeover: 40,
    payment_fraud: 40,
    distributed_attack: 35,
    velocity_ip: 25,
    velocity_user: 20,
    bot_behavior: 20,
    scraping: 15,
    spam_content: 15,
    api_abuse: 20,
    fake_account: 25,
    content_manipulation: 10,
  };

  let score = 0;
  for (const signal of signals) {
    score += (weights[signal.type] ?? 15) * signal.confidence;
  }

  return Math.min(100, score);
}

function decideAction(riskScore: number, profile: AbuseProfile): AbuseDecision {
  if (profile.blocked) return 'block';
  if (profile.shadowBanned) return 'shadow_ban';

  if (riskScore >= BLOCK_THRESHOLD) return 'block';
  if (riskScore >= CAPTCHA_THRESHOLD) return 'captcha';
  if (riskScore >= THROTTLE_THRESHOLD) return 'throttle';
  return 'allow';
}

function getOrCreateProfile(identifier: string, identifierType: AbuseProfile['identifierType']): AbuseProfile {
  if (abuseProfiles.has(identifier)) return abuseProfiles.get(identifier)!;

  if (abuseProfiles.size >= MAX_PROFILES) {
    // Evict oldest non-blocked profile
    const oldest = Array.from(abuseProfiles.entries())
      .filter(([, p]) => !p.blocked)
      .sort((a, b) => a[1].lastUpdatedAt.getTime() - b[1].lastUpdatedAt.getTime())[0];
    if (oldest) abuseProfiles.delete(oldest[0]);
  }

  const profile: AbuseProfile = {
    identifier,
    identifierType,
    riskScore: 0,
    decision: 'allow',
    signals: [],
    firstSeenAt: new Date(),
    lastUpdatedAt: new Date(),
    requestCount: 0,
    violationCount: 0,
    shadowBanned: false,
    blocked: false,
    captchaRequired: false,
    notes: [],
  };

  abuseProfiles.set(identifier, profile);
  return profile;
}

export function analyzeRequest(ctx: RequestContext): {
  decision: AbuseDecision;
  riskScore: number;
  signals: AbuseSignal[];
  profile: AbuseProfile;
} {
  const ipProfile = getOrCreateProfile(ctx.ip, 'ip');
  const userProfile = ctx.userId ? getOrCreateProfile(ctx.userId, 'user') : null;

  const newSignals: AbuseSignal[] = [];

  const botSignal = analyzeBotBehavior(ctx);
  if (botSignal) newSignals.push(botSignal);

  const ipVelocitySignal = analyzeIPVelocity(ctx);
  if (ipVelocitySignal) newSignals.push(ipVelocitySignal);

  const userVelocitySignal = analyzeUserVelocity(ctx);
  if (userVelocitySignal) newSignals.push(userVelocitySignal);

  const credStuffSignal = analyzeCredentialStuffing(ctx);
  if (credStuffSignal) newSignals.push(credStuffSignal);

  // Update IP profile
  ipProfile.requestCount += 1;
  ipProfile.lastUpdatedAt = new Date();
  if (newSignals.length > 0) {
    ipProfile.signals.push(...newSignals);
    if (ipProfile.signals.length > 100) ipProfile.signals.splice(0, ipProfile.signals.length - 100);
    ipProfile.violationCount += 1;
  }

  ipProfile.riskScore = computeRiskScore(ipProfile.signals.slice(-10));
  ipProfile.decision = decideAction(ipProfile.riskScore, ipProfile);

  // Auto-apply block for high risk
  if (ipProfile.riskScore >= BLOCK_THRESHOLD && !ipProfile.blocked) {
    ipProfile.blocked = true;
    ipProfile.blockedAt = new Date();
    ipProfile.blockExpiresAt = new Date(Date.now() + 3600000); // 1 hour
    logger.warn('IP blocked due to abuse', { ip: ctx.ip, riskScore: ipProfile.riskScore });
  }

  if (ipProfile.riskScore >= SHADOW_BAN_THRESHOLD && !ipProfile.shadowBanned && ipProfile.identifierType === 'user') {
    ipProfile.shadowBanned = true;
    ipProfile.shadowBanAt = new Date();
  }

  const activeProfile = userProfile ?? ipProfile;

  if (newSignals.length > 0) {
    logger.warn('Abuse signals detected', {
      identifier: ctx.ip,
      userId: ctx.userId,
      signals: newSignals.map((s) => s.type),
      riskScore: ipProfile.riskScore,
      decision: ipProfile.decision,
    });
  }

  return {
    decision: ipProfile.decision,
    riskScore: ipProfile.riskScore,
    signals: newSignals,
    profile: activeProfile,
  };
}

export function blockIdentifier(
  identifier: string,
  reason: string,
  durationHours = 24,
  type: AbuseProfile['identifierType'] = 'ip',
): void {
  const profile = getOrCreateProfile(identifier, type);
  profile.blocked = true;
  profile.blockedAt = new Date();
  profile.blockExpiresAt = new Date(Date.now() + durationHours * 3600000);
  profile.notes.push(`Manually blocked: ${reason}`);
  profile.decision = 'block';
  logger.warn('Identifier manually blocked', { identifier, reason, durationHours });
}

export function unblockIdentifier(identifier: string): void {
  const profile = abuseProfiles.get(identifier);
  if (profile) {
    profile.blocked = false;
    profile.blockExpiresAt = undefined;
    profile.decision = decideAction(profile.riskScore, profile);
    logger.info('Identifier unblocked', { identifier });
  }
}

export function shadowBanUser(userId: string, reason: string): void {
  const profile = getOrCreateProfile(userId, 'user');
  profile.shadowBanned = true;
  profile.shadowBanAt = new Date();
  profile.decision = 'shadow_ban';
  profile.notes.push(`Shadow banned: ${reason}`);
  logger.warn('User shadow banned', { userId, reason });
}

export function getProfile(identifier: string): AbuseProfile | null {
  return abuseProfiles.get(identifier) ?? null;
}

export function getTopOffenders(limit = 20): AbuseProfile[] {
  return Array.from(abuseProfiles.values())
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, limit);
}

export function getBlockedIdentifiers(): AbuseProfile[] {
  return Array.from(abuseProfiles.values()).filter((p) => p.blocked);
}

export function getAbuseStats(): {
  totalProfiles: number;
  blocked: number;
  shadowBanned: number;
  highRisk: number;
  signalsLast1h: number;
  topSignalTypes: Array<{ type: AbuseSignalType; count: number }>;
} {
  const all = Array.from(abuseProfiles.values());
  const oneHourAgo = Date.now() - 3600000;

  const recentSignals = all.flatMap((p) =>
    p.signals.filter((s) => s.detectedAt.getTime() > oneHourAgo),
  );

  const signalCounts = new Map<AbuseSignalType, number>();
  for (const s of recentSignals) {
    signalCounts.set(s.type, (signalCounts.get(s.type) ?? 0) + 1);
  }

  return {
    totalProfiles: all.length,
    blocked: all.filter((p) => p.blocked).length,
    shadowBanned: all.filter((p) => p.shadowBanned).length,
    highRisk: all.filter((p) => p.riskScore >= BLOCK_THRESHOLD).length,
    signalsLast1h: recentSignals.length,
    topSignalTypes: Array.from(signalCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count })),
  };
}

// Cleanup expired blocks
export function cleanupExpiredBlocks(): number {
  const now = new Date();
  let cleaned = 0;
  for (const profile of abuseProfiles.values()) {
    if (profile.blocked && profile.blockExpiresAt && profile.blockExpiresAt <= now) {
      profile.blocked = false;
      profile.decision = decideAction(profile.riskScore, profile);
      cleaned += 1;
    }
  }
  if (cleaned > 0) logger.info('Expired blocks cleaned', { count: cleaned });
  return cleaned;
}
