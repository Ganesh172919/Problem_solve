/**
 * Abuse Detection Engine for SaaS Platform Billing and Usage Protection
 *
 * Provides comprehensive abuse detection and response:
 * - Rate limit abuse detection (API abuse, scraping)
 * - Free-tier abuse detection (multiple accounts, trial farming)
 * - Resource abuse detection (compute hogging, storage abuse)
 * - Payment fraud detection (stolen cards, charge-backs)
 * - Content abuse detection (spam, inappropriate content)
 * - Behavioral anomaly scoring
 * - Automated response actions (throttle, warn, suspend)
 * - Abuse report management
 */

import { getLogger } from './logger';

const logger = getLogger();

export type AbuseType = 'rate_limit' | 'free_tier' | 'resource' | 'payment' | 'content' | 'behavioral' | 'bot';

export interface AbuseEvent {
  id: string;
  tenantId: string;
  userId: string;
  type: AbuseType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: Record<string, unknown>;
  detectedAt: Date;
  resolvedAt?: Date;
}

export interface AbuseCondition {
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  threshold: number;
  windowMs: number;
}

export interface AbuseAction {
  type: 'log' | 'warn' | 'throttle' | 'suspend' | 'ban';
  duration?: number;
  notifyAdmin: boolean;
  notifyUser: boolean;
}

export interface AbuseRule {
  id: string;
  name: string;
  type: AbuseType;
  conditions: AbuseCondition[];
  action: AbuseAction;
  enabled: boolean;
  cooldownMs: number;
}

export interface AbuseReport {
  id: string;
  reporterId: string;
  targetId: string;
  type: AbuseType;
  description: string;
  evidence: string[];
  status: 'pending' | 'investigating' | 'confirmed' | 'dismissed';
  createdAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
}

export interface UserRiskProfile {
  userId: string;
  tenantId: string;
  riskScore: number;
  flags: string[];
  accountAge: number;
  totalApiCalls: number;
  totalSpend: number;
  violationHistory: AbuseEvent[];
  lastAssessed: Date;
}

export interface AbuseStats {
  totalEvents: number;
  eventsByType: Record<AbuseType, number>;
  eventsBySeverity: Record<string, number>;
  activeRules: number;
  avgRiskScore: number;
  suspendedAccounts: number;
  topOffenders: Array<{ userId: string; eventCount: number; riskScore: number }>;
}

interface ActivityRecord {
  metric: string;
  value: number;
  timestamp: number;
}

interface UserState {
  activities: ActivityRecord[];
  tenantId: string;
  riskScore: number;
  flags: Set<string>;
  accountAge: number;
  totalApiCalls: number;
  totalSpend: number;
  suspended: boolean;
  banned: boolean;
  throttledUntil: number;
  warnedAt?: number;
}

export class AbuseDetectionEngine {
  private rules: Map<string, AbuseRule> = new Map();
  private events: AbuseEvent[] = [];
  private reports: Map<string, AbuseReport> = new Map();
  private users: Map<string, UserState> = new Map();
  private lastRuleFired: Map<string, number> = new Map();
  private idCounter = 0;

  constructor() {
    logger.info('AbuseDetectionEngine initialized');
  }

  private generateId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_${Date.now()}_${this.idCounter}`;
  }

  private getOrCreateUser(userId: string, tenantId?: string): UserState {
    let user = this.users.get(userId);
    if (!user) {
      user = {
        activities: [],
        tenantId: tenantId ?? 'unknown',
        riskScore: 0,
        flags: new Set(),
        accountAge: 0,
        totalApiCalls: 0,
        totalSpend: 0,
        suspended: false,
        banned: false,
        throttledUntil: 0,
      };
      this.users.set(userId, user);
    }
    if (tenantId) {
      user.tenantId = tenantId;
    }
    return user;
  }

  private pruneActivities(activities: ActivityRecord[], windowMs: number): ActivityRecord[] {
    const cutoff = Date.now() - windowMs;
    return activities.filter((a) => a.timestamp >= cutoff);
  }

  private evaluateCondition(activities: ActivityRecord[], condition: AbuseCondition): boolean {
    const cutoff = Date.now() - condition.windowMs;
    const relevant = activities.filter(
      (a) => a.metric === condition.metric && a.timestamp >= cutoff
    );
    const aggregated = relevant.reduce((sum, a) => sum + a.value, 0);

    switch (condition.operator) {
      case 'gt':
        return aggregated > condition.threshold;
      case 'lt':
        return aggregated < condition.threshold;
      case 'eq':
        return aggregated === condition.threshold;
      case 'gte':
        return aggregated >= condition.threshold;
      case 'lte':
        return aggregated <= condition.threshold;
      default:
        return false;
    }
  }

  private severityFromAction(actionType: AbuseAction['type']): AbuseEvent['severity'] {
    const map: Record<AbuseAction['type'], AbuseEvent['severity']> = {
      log: 'low', warn: 'medium', throttle: 'high', suspend: 'critical', ban: 'critical',
    };
    return map[actionType] ?? 'low';
  }

  addRule(rule: Omit<AbuseRule, 'id'>): AbuseRule {
    const fullRule: AbuseRule = { ...rule, id: this.generateId('rule') };
    this.rules.set(fullRule.id, fullRule);
    logger.info(`Rule added: ${fullRule.name} [${fullRule.id}]`);
    return fullRule;
  }

  removeRule(ruleId: string): void {
    if (!this.rules.delete(ruleId)) {
      logger.warn(`Rule not found: ${ruleId}`);
    }
  }

  getRules(): AbuseRule[] {
    return Array.from(this.rules.values());
  }

  recordActivity(userId: string, tenantId: string, metric: string, value: number): void {
    const user = this.getOrCreateUser(userId, tenantId);
    user.activities.push({ metric, value, timestamp: Date.now() });
    user.totalApiCalls += 1;

    // Keep sliding window bounded: prune entries older than 24 hours
    const maxWindow = 86_400_000;
    if (user.activities.length > 10_000) {
      user.activities = this.pruneActivities(user.activities, maxWindow);
    }
  }

  checkAbuse(userId: string, tenantId: string): AbuseEvent[] {
    const user = this.getOrCreateUser(userId, tenantId);
    const detected: AbuseEvent[] = [];
    const now = Date.now();

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      // Enforce cooldown per rule
      const lastFired = this.lastRuleFired.get(`${userId}:${rule.id}`) ?? 0;
      if (now - lastFired < rule.cooldownMs) continue;

      const allMet = rule.conditions.every((cond) =>
        this.evaluateCondition(user.activities, cond)
      );

      if (allMet) {
        this.lastRuleFired.set(`${userId}:${rule.id}`, now);

        const event: AbuseEvent = {
          id: this.generateId('evt'),
          tenantId,
          userId,
          type: rule.type,
          severity: this.severityFromAction(rule.action.type),
          details: { ruleName: rule.name, ruleId: rule.id },
          detectedAt: new Date(),
        };
        this.events.push(event);
        detected.push(event);

        logger.warn(`Abuse detected for user ${userId}: ${rule.name} [${event.severity}]`);

        this.executeAction(userId, rule.action);
        this.adjustRiskFromEvent(userId, event);
      }
    }

    return detected;
  }

  getRiskProfile(userId: string): UserRiskProfile {
    const user = this.getOrCreateUser(userId);
    const violations = this.events.filter((e) => e.userId === userId);

    return {
      userId,
      tenantId: user.tenantId,
      riskScore: Math.min(100, Math.max(0, user.riskScore)),
      flags: Array.from(user.flags),
      accountAge: user.accountAge,
      totalApiCalls: user.totalApiCalls,
      totalSpend: user.totalSpend,
      violationHistory: violations,
      lastAssessed: new Date(),
    };
  }

  updateRiskScore(userId: string, adjustment: number, reason: string): void {
    const user = this.getOrCreateUser(userId);
    const previous = user.riskScore;
    user.riskScore = Math.min(100, Math.max(0, user.riskScore + adjustment));
    logger.info(
      `Risk score for ${userId}: ${previous} -> ${user.riskScore} (${reason})`
    );

    if (user.riskScore >= 80) {
      user.flags.add('high_risk');
    } else {
      user.flags.delete('high_risk');
    }
  }

  submitReport(report: Omit<AbuseReport, 'id' | 'status' | 'createdAt'>): AbuseReport {
    const fullReport: AbuseReport = {
      ...report,
      id: this.generateId('rpt'),
      status: 'pending',
      createdAt: new Date(),
    };
    this.reports.set(fullReport.id, fullReport);
    logger.info(`Abuse report submitted: ${fullReport.id} against ${fullReport.targetId}`);
    return fullReport;
  }

  reviewReport(
    reportId: string,
    status: 'confirmed' | 'dismissed',
    reviewedBy: string
  ): AbuseReport {
    const report = this.reports.get(reportId);
    if (!report) {
      throw new Error(`Report not found: ${reportId}`);
    }

    report.status = status;
    report.reviewedAt = new Date();
    report.reviewedBy = reviewedBy;

    if (status === 'confirmed') {
      this.updateRiskScore(report.targetId, 15, `confirmed report ${reportId}`);
      const user = this.getOrCreateUser(report.targetId);
      user.flags.add(`confirmed_${report.type}`);
    }

    logger.info(`Report ${reportId} reviewed as ${status} by ${reviewedBy}`);
    return report;
  }

  getReports(status?: string): AbuseReport[] {
    const all = Array.from(this.reports.values());
    if (!status) return all;
    return all.filter((r) => r.status === status);
  }

  getEvents(userId?: string, type?: AbuseType): AbuseEvent[] {
    let results = this.events;
    if (userId) {
      results = results.filter((e) => e.userId === userId);
    }
    if (type) {
      results = results.filter((e) => e.type === type);
    }
    return results;
  }

  executeAction(userId: string, action: AbuseAction): void {
    const user = this.getOrCreateUser(userId);

    switch (action.type) {
      case 'log':
        logger.info(`[action:log] User ${userId} flagged`);
        break;
      case 'warn':
        user.warnedAt = Date.now();
        user.flags.add('warned');
        logger.info(`[action:warn] User ${userId} warned`);
        break;
      case 'throttle': {
        const duration = action.duration ?? 60_000;
        user.throttledUntil = Date.now() + duration;
        user.flags.add('throttled');
        logger.info(`[action:throttle] User ${userId} throttled for ${duration}ms`);
        break;
      }
      case 'suspend':
        user.suspended = true;
        user.flags.add('suspended');
        logger.warn(`[action:suspend] User ${userId} suspended`);
        break;
      case 'ban':
        user.banned = true;
        user.suspended = true;
        user.flags.add('banned');
        logger.warn(`[action:ban] User ${userId} banned`);
        break;
    }

    if (action.notifyAdmin) {
      logger.info(`[notify:admin] Action ${action.type} on user ${userId}`);
    }
    if (action.notifyUser) {
      logger.info(`[notify:user] Action ${action.type} sent to user ${userId}`);
    }
  }

  getStats(): AbuseStats {
    const typeInit: Record<AbuseType, number> = {
      rate_limit: 0, free_tier: 0, resource: 0, payment: 0, content: 0, behavioral: 0, bot: 0,
    };
    const sevInit: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };

    for (const evt of this.events) {
      typeInit[evt.type] += 1;
      sevInit[evt.severity] += 1;
    }

    let totalRisk = 0;
    let userCount = 0;
    let suspendedCount = 0;
    const offenderMap = new Map<string, { count: number; risk: number }>();

    for (const [uid, state] of this.users.entries()) {
      totalRisk += state.riskScore;
      userCount += 1;
      if (state.suspended) suspendedCount += 1;
    }

    for (const evt of this.events) {
      const entry = offenderMap.get(evt.userId) ?? { count: 0, risk: 0 };
      entry.count += 1;
      offenderMap.set(evt.userId, entry);
    }

    for (const [uid, entry] of offenderMap.entries()) {
      const user = this.users.get(uid);
      entry.risk = user?.riskScore ?? 0;
    }

    const topOffenders = Array.from(offenderMap.entries())
      .map(([userId, { count, risk }]) => ({ userId, eventCount: count, riskScore: risk }))
      .sort((a, b) => b.eventCount - a.eventCount)
      .slice(0, 10);

    return {
      totalEvents: this.events.length,
      eventsByType: typeInit,
      eventsBySeverity: sevInit,
      activeRules: Array.from(this.rules.values()).filter((r) => r.enabled).length,
      avgRiskScore: userCount > 0 ? Math.round(totalRisk / userCount) : 0,
      suspendedAccounts: suspendedCount,
      topOffenders,
    };
  }

  private adjustRiskFromEvent(userId: string, event: AbuseEvent): void {
    const inc: Record<AbuseEvent['severity'], number> = { low: 3, medium: 8, high: 15, critical: 25 };
    this.updateRiskScore(userId, inc[event.severity], `abuse event ${event.id}`);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __abuseDetectionEngine__: AbuseDetectionEngine | undefined;
}

export function getAbuseDetectionEngine(): AbuseDetectionEngine {
  if (!globalThis.__abuseDetectionEngine__) {
    globalThis.__abuseDetectionEngine__ = new AbuseDetectionEngine();
  }
  return globalThis.__abuseDetectionEngine__;
}
