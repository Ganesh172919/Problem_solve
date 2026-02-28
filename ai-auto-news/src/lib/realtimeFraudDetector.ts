/**
 * @module realtimeFraudDetector
 * @description Real-time fraud detection engine using rule-based scoring,
 * velocity checks, device fingerprinting, behavioral anomaly detection, and
 * ML-based risk scoring. Supports transaction, account, and API abuse patterns.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type FraudSignalType =
  | 'velocity_abuse'
  | 'geo_anomaly'
  | 'device_mismatch'
  | 'behavioral_anomaly'
  | 'account_takeover'
  | 'payment_fraud'
  | 'api_abuse'
  | 'content_spam'
  | 'identity_theft'
  | 'bot_activity';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'clear';

export interface FraudSignal {
  type: FraudSignalType;
  score: number; // 0-100
  confidence: number; // 0-1
  details: Record<string, unknown>;
  timestamp: number;
}

export interface FraudAssessment {
  requestId: string;
  userId: string;
  tenantId: string;
  riskLevel: RiskLevel;
  riskScore: number; // 0-100
  signals: FraudSignal[];
  action: 'allow' | 'challenge' | 'block' | 'review';
  reasons: string[];
  processingMs: number;
  timestamp: number;
}

export interface UserBehaviorProfile {
  userId: string;
  avgSessionDurationMs: number;
  typicalHours: number[];      // Hours of day usually active
  knownIPs: string[];
  knownDevices: string[];
  knownCountries: string[];
  avgTransactionAmount: number;
  transactionStdDev: number;
  requestsPerMinute: number;
  lastActivity: number;
  suspicionScore: number;
}

export interface FraudEvent {
  userId: string;
  tenantId: string;
  action: string;
  ipAddress: string;
  country: string;
  deviceFingerprint: string;
  amount?: number;
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface VelocityWindow {
  key: string;
  count: number;
  windowStart: number;
  windowMs: number;
  limit: number;
}

export interface FraudDetectorConfig {
  velocityWindowMs: number;
  maxRequestsPerWindow: number;
  geoRiskCountries: string[];
  criticalRiskThreshold: number;
  highRiskThreshold: number;
  mediumRiskThreshold: number;
  enableMLScoring: boolean;
  blockOnCritical: boolean;
  challengeOnHigh: boolean;
}

// ── Velocity Tracker ──────────────────────────────────────────────────────────

class VelocityTracker {
  private windows = new Map<string, VelocityWindow>();

  record(key: string, windowMs: number, limit: number): VelocityWindow {
    const existing = this.windows.get(key);
    const now = Date.now();

    if (!existing || now - existing.windowStart > windowMs) {
      const window: VelocityWindow = { key, count: 1, windowStart: now, windowMs, limit };
      this.windows.set(key, window);
      return window;
    }

    existing.count++;
    return existing;
  }

  isExceeded(key: string): boolean {
    const w = this.windows.get(key);
    return w ? w.count > w.limit : false;
  }

  getCount(key: string): number {
    return this.windows.get(key)?.count ?? 0;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, window] of this.windows.entries()) {
      if (now - window.windowStart > window.windowMs * 2) {
        this.windows.delete(key);
      }
    }
  }
}

// ── ML Risk Scorer (Feature-based) ───────────────────────────────────────────

function computeMLRiskScore(
  event: FraudEvent,
  profile: UserBehaviorProfile | undefined
): number {
  if (!profile) return 30; // Unknown users get moderate score

  let score = 0;

  // Time-of-day anomaly
  const hour = new Date(event.timestamp).getHours();
  if (!profile.typicalHours.includes(hour)) score += 15;

  // New IP
  if (!profile.knownIPs.includes(event.ipAddress)) score += 20;

  // New country
  if (!profile.knownCountries.includes(event.country)) score += 25;

  // New device
  if (!profile.knownDevices.includes(event.deviceFingerprint)) score += 15;

  // Transaction anomaly
  if (event.amount !== undefined && profile.avgTransactionAmount > 0) {
    const zScore = Math.abs(event.amount - profile.avgTransactionAmount) /
      Math.max(1, profile.transactionStdDev);
    if (zScore > 3) score += 25;
    else if (zScore > 2) score += 10;
  }

  // Inactive account suddenly active
  const daysSinceActivity = (Date.now() - profile.lastActivity) / 86400_000;
  if (daysSinceActivity > 30) score += 10;

  return Math.min(100, score);
}

// ── Core Detector ─────────────────────────────────────────────────────────────

export class RealtimeFraudDetector {
  private velocity = new VelocityTracker();
  private profiles = new Map<string, UserBehaviorProfile>();
  private assessmentHistory = new Map<string, FraudAssessment[]>();
  private blocklist = new Set<string>(); // IPs or userIds
  private totalAssessments = 0;
  private blockedCount = 0;
  private config: FraudDetectorConfig;

  constructor(config?: Partial<FraudDetectorConfig>) {
    this.config = {
      velocityWindowMs: 60_000,
      maxRequestsPerWindow: 100,
      geoRiskCountries: [],
      criticalRiskThreshold: 80,
      highRiskThreshold: 60,
      mediumRiskThreshold: 40,
      enableMLScoring: true,
      blockOnCritical: true,
      challengeOnHigh: true,
      ...config,
    };

    // Cleanup velocity windows periodically
    setInterval(() => this.velocity.cleanup(), 300_000);
  }

  updateProfile(profile: UserBehaviorProfile): void {
    this.profiles.set(profile.userId, profile);
  }

  addToBlocklist(identifier: string): void {
    this.blocklist.add(identifier);
    logger.warn('Added to fraud blocklist', { identifier });
  }

  removeFromBlocklist(identifier: string): void {
    this.blocklist.delete(identifier);
  }

  async assess(event: FraudEvent): Promise<FraudAssessment> {
    const start = Date.now();
    const signals: FraudSignal[] = [];
    const reasons: string[] = [];
    this.totalAssessments++;

    // Blocklist check
    if (this.blocklist.has(event.userId) || this.blocklist.has(event.ipAddress)) {
      const assessment: FraudAssessment = {
        requestId: `fraud_${Date.now()}`,
        userId: event.userId,
        tenantId: event.tenantId,
        riskLevel: 'critical',
        riskScore: 100,
        signals: [{ type: 'account_takeover', score: 100, confidence: 1, details: { blocklisted: true }, timestamp: Date.now() }],
        action: 'block',
        reasons: ['User or IP is blocklisted'],
        processingMs: Date.now() - start,
        timestamp: Date.now(),
      };
      this.blockedCount++;
      return assessment;
    }

    const profile = this.profiles.get(event.userId);

    // 1. Velocity check
    const velocityKey = `${event.userId}:requests`;
    const velocityWindow = this.velocity.record(velocityKey, this.config.velocityWindowMs, this.config.maxRequestsPerWindow);
    if (velocityWindow.count > this.config.maxRequestsPerWindow) {
      const score = Math.min(100, 50 + (velocityWindow.count - this.config.maxRequestsPerWindow) * 2);
      signals.push({
        type: 'velocity_abuse',
        score,
        confidence: 0.95,
        details: { count: velocityWindow.count, limit: this.config.maxRequestsPerWindow, windowMs: this.config.velocityWindowMs },
        timestamp: Date.now(),
      });
      reasons.push(`Velocity limit exceeded: ${velocityWindow.count} requests in window`);
    }

    // 2. Geo risk
    if (this.config.geoRiskCountries.includes(event.country)) {
      signals.push({
        type: 'geo_anomaly',
        score: 40,
        confidence: 0.7,
        details: { country: event.country, flaggedCountries: this.config.geoRiskCountries },
        timestamp: Date.now(),
      });
      reasons.push(`Request from high-risk country: ${event.country}`);
    }

    // 3. New device/IP for known user
    if (profile) {
      if (!profile.knownIPs.includes(event.ipAddress)) {
        signals.push({
          type: 'device_mismatch',
          score: 30,
          confidence: 0.8,
          details: { newIP: event.ipAddress, knownIPs: profile.knownIPs.slice(0, 3) },
          timestamp: Date.now(),
        });
        reasons.push('Request from unrecognized IP address');
      }

      if (!profile.knownDevices.includes(event.deviceFingerprint)) {
        signals.push({
          type: 'device_mismatch',
          score: 35,
          confidence: 0.85,
          details: { newDevice: event.deviceFingerprint },
          timestamp: Date.now(),
        });
        reasons.push('Request from unrecognized device');
      }
    }

    // 4. ML scoring
    if (this.config.enableMLScoring) {
      const mlScore = computeMLRiskScore(event, profile);
      if (mlScore > 20) {
        signals.push({
          type: 'behavioral_anomaly',
          score: mlScore,
          confidence: 0.75,
          details: { mlScore, features: { hasProfile: !!profile } },
          timestamp: Date.now(),
        });
        if (mlScore > 50) reasons.push(`ML risk score: ${mlScore}/100`);
      }
    }

    // 5. API abuse detection
    const apiKey = `${event.ipAddress}:api`;
    const apiWindow = this.velocity.record(apiKey, 1000, 20); // 20 req/sec
    if (apiWindow.count > 20) {
      signals.push({
        type: 'api_abuse',
        score: 70,
        confidence: 0.9,
        details: { requestsPerSecond: apiWindow.count },
        timestamp: Date.now(),
      });
      reasons.push('API request rate exceeds 20 req/sec');
    }

    // Aggregate risk score (weighted max)
    const riskScore = signals.length === 0 ? 0 :
      Math.min(100, signals.reduce((max, s) => Math.max(max, s.score * s.confidence), 0) +
        signals.slice(1).reduce((sum, s) => sum + s.score * s.confidence * 0.3, 0));

    const riskLevel = this.scoreToLevel(riskScore);
    const action = this.determineAction(riskLevel);

    const assessment: FraudAssessment = {
      requestId: `fraud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: event.userId,
      tenantId: event.tenantId,
      riskLevel,
      riskScore: Math.round(riskScore),
      signals,
      action,
      reasons,
      processingMs: Date.now() - start,
      timestamp: Date.now(),
    };

    // Store history
    const history = this.assessmentHistory.get(event.userId) ?? [];
    history.push(assessment);
    if (history.length > 100) history.shift();
    this.assessmentHistory.set(event.userId, history);

    if (action === 'block') this.blockedCount++;

    if (riskLevel === 'high' || riskLevel === 'critical') {
      logger.warn('Fraud risk detected', {
        userId: event.userId,
        riskLevel,
        riskScore: assessment.riskScore,
        signalCount: signals.length,
      });
    }

    return assessment;
  }

  private scoreToLevel(score: number): RiskLevel {
    if (score >= this.config.criticalRiskThreshold) return 'critical';
    if (score >= this.config.highRiskThreshold) return 'high';
    if (score >= this.config.mediumRiskThreshold) return 'medium';
    if (score > 0) return 'low';
    return 'clear';
  }

  private determineAction(level: RiskLevel): FraudAssessment['action'] {
    if (level === 'critical' && this.config.blockOnCritical) return 'block';
    if (level === 'high' && this.config.challengeOnHigh) return 'challenge';
    if (level === 'medium') return 'review';
    return 'allow';
  }

  getUserHistory(userId: string): FraudAssessment[] {
    return this.assessmentHistory.get(userId) ?? [];
  }

  getStats(): {
    totalAssessments: number;
    blockedCount: number;
    blockRate: number;
    profiledUsers: number;
    blocklistedCount: number;
  } {
    return {
      totalAssessments: this.totalAssessments,
      blockedCount: this.blockedCount,
      blockRate: this.totalAssessments > 0 ? this.blockedCount / this.totalAssessments : 0,
      profiledUsers: this.profiles.size,
      blocklistedCount: this.blocklist.size,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
   
  var __realtimeFraudDetector__: RealtimeFraudDetector | undefined;
}

export function getFraudDetector(): RealtimeFraudDetector {
  if (!globalThis.__realtimeFraudDetector__) {
    globalThis.__realtimeFraudDetector__ = new RealtimeFraudDetector();
  }
  return globalThis.__realtimeFraudDetector__;
}
